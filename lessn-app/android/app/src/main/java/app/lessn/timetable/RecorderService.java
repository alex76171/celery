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
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) { stopRecording(); return START_NOT_STICKY; }
        if (ACTION_CANCEL.equals(action)) { cancelArm(); return START_NOT_STICKY; }
        if (ACTION_START.equals(action) && recorder == null) {
            title = intent.getStringExtra("title") == null ? "Recording" : intent.getStringExtra("title");
            background = false;
            startForegroundNotif(title, false, 0);
            begin(intent.getIntExtra("maxMinutes", 100) * 60_000L);
        }
        if (ACTION_ARM.equals(action) && recorder == null) {
            NotificationManagerCompat.from(this).cancel(intent.getIntExtra("nid", 0));
            title = intent.getStringExtra("title") == null ? "Lesson" : intent.getStringExtra("title");
            meta = intent.getStringExtra("meta") == null ? "{}" : intent.getStringExtra("meta");
            background = true;
            long start = intent.getLongExtra("startAt", System.currentTimeMillis());
            long end = intent.getLongExtra("endAt", start + 45 * 60_000L);
            long now = System.currentTimeMillis();
            if (end <= now) { stopSelf(); return START_NOT_STICKY; }
            armedFor = start;
            holdWake(end - now + 5 * 60_000L);
            startForegroundNotif(title, start > now, start);
            handler.postDelayed(() -> {
                armedFor = 0;
                startForegroundNotif(title, false, 0);
                begin(Math.max(60_000L, end - System.currentTimeMillis()));
            }, Math.max(0, start - now));
        }
        return START_NOT_STICKY;
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
            recorder = null;
            currentPath = null;
            releaseWake();
            stopSelf();
        }
    }

    private void startForegroundNotif(String title, boolean waiting, long startAt) {
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
