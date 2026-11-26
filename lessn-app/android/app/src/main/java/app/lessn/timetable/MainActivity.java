package app.lessn.timetable;

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
    }
}
