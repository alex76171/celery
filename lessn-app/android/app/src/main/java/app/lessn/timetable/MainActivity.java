package app.lessn.timetable;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LessnPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
