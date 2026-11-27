package app.lessn.timetable;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private Intent pendingArm = null;
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LessnPlugin.class);
        super.onCreate(savedInstanceState);
        // No haptic ticks (e.g. on long-press) anywhere in the app
        getWindow().getDecorView().setHapticFeedbackEnabled(false);
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().setHapticFeedbackEnabled(false);
        keepTarget(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        keepTarget(intent);
    }

    /** A notification can say which screen to open; the app asks for it with takeLaunch(). */
    private void keepTarget(Intent intent) {
        if (intent == null) return;
        String target = intent.getStringExtra("lessn_open");
        int nid = intent.getIntExtra("nid", 0);
        if (nid != 0) androidx.core.app.NotificationManagerCompat.from(this).cancel(nid);
        if (intent.getLongExtra("arm_end", 0) > 0) { pendingArm = new Intent(intent); intent.removeExtra("arm_end"); }
        if (target != null) Scheduler.prefs(this).edit().putString("launch", target).putLong("launchAt", System.currentTimeMillis()).apply();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingArm == null) return;
        final Intent src = pendingArm;
        pendingArm = null;
        // started once the app is visible: Android then allows the microphone to keep recording with the screen locked
        new Handler(Looper.getMainLooper()).postDelayed(() -> armFrom(src), 300);
    }

    /** "Yes" on the "Record this lesson?" notification. */
    private void armFrom(Intent src) {
        long start = src.getLongExtra("arm_start", 0), end = src.getLongExtra("arm_end", 0);
        if (end <= System.currentTimeMillis()) { Toast.makeText(this, "This lesson is already over", Toast.LENGTH_LONG).show(); return; }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            // the app asks for the microphone and arms it from the Home card
            Scheduler.prefs(this).edit().putString("launch", "rec-perm").putLong("launchAt", System.currentTimeMillis()).apply();
            return;
        }
        Intent i = new Intent(this, RecorderService.class).setAction(RecorderService.ACTION_ARM)
            .putExtra("startAt", start).putExtra("endAt", end)
            .putExtra("title", src.getStringExtra("arm_title")).putExtra("meta", src.getStringExtra("arm_meta"));
        try {
            ContextCompat.startForegroundService(this, i);
            Toast.makeText(this, "Recording is set up – you can lock the phone", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Recording could not be set up", Toast.LENGTH_LONG).show();
        }
    }
}
