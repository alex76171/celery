package app.lessn.timetable;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
        if (target != null) Scheduler.prefs(this).edit().putString("launch", target).putLong("launchAt", System.currentTimeMillis()).apply();
    }
}
