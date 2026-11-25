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
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.File;

/** Foreground service that records audio with the screen off. */
public class RecorderService extends Service {
    static final String ACTION_START = "start";
    static final String ACTION_STOP = "stop";

    static volatile String currentPath = null;
    static volatile long startedAt = 0;
    static volatile String lastPath = null;
    static volatile long lastDuration = 0;

    private MediaRecorder recorder;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopRecording();
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action) && recorder == null) {
            String title = intent.getStringExtra("title");
            int maxMin = intent.getIntExtra("maxMinutes", 100);
            startForegroundNotif(title == null ? "Recording" : title);
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
                handler.postDelayed(this::stopRecording, maxMin * 60_000L);
            } catch (Exception e) {
                recorder = null;
                currentPath = null;
                stopSelf();
            }
        }
        return START_NOT_STICKY;
    }

    private void startForegroundNotif(String title) {
        Notifs.ensureChannels(this);
        Intent stop = new Intent(this, RecorderService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 3, stop, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, Notifs.CH_RECORDING)
            .setSmallIcon(R.drawable.ic_stat_lessn)
            .setContentTitle(title)
            .setContentText("Lessn")
            .setOngoing(true)
            .setUsesChronometer(true)
            .setWhen(System.currentTimeMillis())
            .setContentIntent(Notifs.openApp(this))
            .addAction(0, "Stop", stopPi)
            .build();
        int type = Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        ServiceCompat.startForeground(this, 77, n, type);
    }

    private void stopRecording() {
        handler.removeCallbacksAndMessages(null);
        if (recorder != null) {
            try { recorder.stop(); } catch (Exception ignored) { }
            recorder.release();
            recorder = null;
            lastPath = currentPath;
            lastDuration = System.currentTimeMillis() - startedAt;
        }
        currentPath = null;
        startedAt = 0;
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (recorder != null) stopRecording();
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
