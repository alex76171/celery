package app.lessn.timetable;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import java.io.File;
import java.text.DateFormat;
import java.util.Date;

/**
 * Foreground service that records audio with the screen off.
 * ACTION_START records now (from the app). ACTION_ARM is started from the "Record this lesson?" notification:
 * it waits until the lesson begins, records, stops when the lesson ends and leaves the file for the app to summarize.
 */
public class RecorderService extends Service {
    static final String ACTION_START = "start";
    static final String ACTION_STOP = "stop";
    static final String ACTION_ARM = "arm";
    static final String ACTION_CANCEL = "cancel";

    static volatile String currentPath = null;
    static volatile long startedAt = 0;
    static volatile String lastPath = null;
    static volatile long lastDuration = 0;
    static volatile long armedFor = 0;

    private MediaRecorder recorder;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wake;
    private boolean background = false; // armed from a notification: the app picks the file up later
    private String meta = "{}";
    private String title = "Recording";

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            return handle(intent);
        } catch (Exception e) {
            // never take the app down: tell the user instead
            fail("Recording could not start", "Open Lessn and tap Yes on the Home screen to record this lesson.");
            return START_NOT_STICKY;
        }
    }

    private int handle(Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) { stopRecording(); return START_NOT_STICKY; }
        if (ACTION_CANCEL.equals(action)) { cancelArm(); return START_NOT_STICKY; }
        if (ACTION_START.equals(action)) {
            if (recorder != null) return START_NOT_STICKY;
            title = intent.getStringExtra("title") == null ? "Recording" : intent.getStringExtra("title");
            background = false;
            if (!startForegroundNotif(title, false, 0)) return START_NOT_STICKY;
            begin(intent.getIntExtra("maxMinutes", 100) * 60_000L);
            return START_NOT_STICKY;
        }
        if (ACTION_ARM.equals(action)) {
            NotificationManagerCompat.from(this).cancel(intent.getIntExtra("nid", 0));
            long now = System.currentTimeMillis();
            long start = intent.getLongExtra("startAt", 0);
            long end = intent.getLongExtra("endAt", 0);
            if (start <= 0) start = now;
            if (end <= start) end = start + 45 * 60_000L;
            // startForeground() must always be called after startForegroundService(), or Android closes the app
            String t = intent.getStringExtra("title") == null ? "Lesson" : intent.getStringExtra("title");
            if (recorder != null) { startForegroundNotif(title, false, 0); return START_NOT_STICKY; }
            if (!startForegroundNotif(t, start > now, start)) return START_NOT_STICKY;
            if (end <= now) { cancelArm(); return START_NOT_STICKY; }
            title = t;
            meta = intent.getStringExtra("meta") == null ? "{}" : intent.getStringExtra("meta");
            background = true;
            handler.removeCallbacksAndMessages(null);
            armedFor = start;
            releaseWake();
            holdWake(end - now + 5 * 60_000L);
            final long endAt = end;
            handler.postDelayed(() -> {
                armedFor = 0;
                startForegroundNotif(title, false, 0);
                begin(Math.max(60_000L, endAt - System.currentTimeMillis()));
            }, Math.max(0, start - now));
            return START_NOT_STICKY;
        }
        // unknown or empty intent (e.g. restarted by the system): satisfy Android, then stop
        if (recorder == null && armedFor == 0) { startForegroundNotif(title, false, 0); cancelArm(); }
        return START_NOT_STICKY;
    }

    private void fail(String head, String body) {
        try { Notifs.showTo(this, 6998, Notifs.CH_RECASK, head, body, "today"); } catch (Exception ignored) { }
        recorder = null;
        currentPath = null;
        armedFor = 0;
        handler.removeCallbacksAndMessages(null);
        releaseWake();
        try { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE); } catch (Exception ignored) { }
        stopSelf();
    }

    private void holdWake(long ms) {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "lessn:recorder");
            wake.acquire(Math.min(ms, 3 * 60 * 60_000L));
        } catch (Exception ignored) { }
    }

    private void begin(long durationMs) {
        try {
            File dir = new File(getFilesDir(), "recordings");
            dir.mkdirs();
            File f = new File(dir, "rec_" + System.currentTimeMillis() + ".m4a");
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(this) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);
            recorder.setAudioSamplingRate(16000);
            recorder.setAudioEncodingBitRate(24000);
            recorder.setOutputFile(f.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            currentPath = f.getAbsolutePath();
            startedAt = System.currentTimeMillis();
            handler.postDelayed(this::stopRecording, durationMs);
        } catch (Exception e) {
            if (recorder != null) { try { recorder.release(); } catch (Exception ignored) { } }
            fail(title + ": recording failed", "The microphone could not be used (maybe another app is using it). Open Lessn to try again.");
        }
    }

    private boolean startForegroundNotif(String title, boolean waiting, long startAt) {
        try {
            buildAndStart(title, waiting, startAt);
            return true;
        } catch (Exception e) {
            // Android 14+ refuses a microphone service started while Lessn is in the background
            // still call startForeground (with a non-microphone type) so Android does not close the app, then stop
            if (Build.VERSION.SDK_INT >= 30) {
                try { ServiceCompat.startForeground(this, 77, new NotificationCompat.Builder(this, Notifs.CH_RECORDING).setSmallIcon(R.drawable.ic_stat_lessn).setContentTitle(title).setSilent(true).build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC); } catch (Exception ignored) { }
            }
            fail("Open Lessn to record " + title, "Android only allows recording when it is set up from the app. Tap here, then tap Yes on the Home screen.");
            return false;
        }
    }

    private void buildAndStart(String title, boolean waiting, long startAt) {
        Notifs.ensureChannels(this);
        Intent stop = new Intent(this, RecorderService.class).setAction(waiting ? ACTION_CANCEL : ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 3, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, Notifs.CH_RECORDING)
            .setSmallIcon(R.drawable.ic_stat_lessn)
            .setContentTitle(title)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(Notifs.openApp(this, "recorder"))
            .addAction(0, waiting ? "Cancel" : "Stop", stopPi);
        if (waiting) b.setContentText("Recording starts at " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(startAt)));
        else b.setContentText("Recording · Lessn").setUsesChronometer(true).setWhen(System.currentTimeMillis());
        int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        ServiceCompat.startForeground(this, 77, b.build(), type);
    }

    private void cancelArm() {
        handler.removeCallbacksAndMessages(null);
        armedFor = 0;
        releaseWake();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void stopRecording() {
        handler.removeCallbacksAndMessages(null);
        armedFor = 0;
        if (recorder != null) {
            try { recorder.stop(); } catch (Exception ignored) { }
            recorder.release();
            recorder = null;
            lastPath = currentPath;
            lastDuration = System.currentTimeMillis() - startedAt;
            if (background && lastPath != null) {
                Scheduler.addDoneRecording(this, lastPath, lastDuration, meta);
                Notifs.showTo(this, 6999, Notifs.CH_PLANNER, title + " recorded", "Tap to get the AI summary, homework and tests.", "rec");
            }
        }
        currentPath = null;
        startedAt = 0;
        releaseWake();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void releaseWake() { try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) { } wake = null; }

    @Override
    public void onDestroy() {
        if (recorder != null) stopRecording();
        releaseWake();
        super.onDestroy();
    }

    static void start(Context ctx, String title, int maxMinutes) {
        Intent i = new Intent(ctx, RecorderService.class).setAction(ACTION_START).putExtra("title", title).putExtra("maxMinutes", maxMinutes);
        androidx.core.content.ContextCompat.startForegroundService(ctx, i);
    }

    static void stop(Context ctx) {
        ctx.startService(new Intent(ctx, RecorderService.class).setAction(ACTION_STOP));
    }
}
