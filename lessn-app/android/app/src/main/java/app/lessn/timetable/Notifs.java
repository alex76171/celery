package app.lessn.timetable;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Notification channels and helpers. */
public final class Notifs {
    public static final String CH_LESSONS = "lessons_quiet";
    public static final String CH_PRESENCE = "presence_quiet";
    public static final String CH_RECORDING = "recording_quiet";
    public static final String CH_ISERV = "iserv_quiet";

    private Notifs() {}

    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        // Channels can't be changed after creation, so the silent (no vibration) versions get new ids
        for (String old : new String[] { "lessons", "presence", "recording", "iserv" }) nm.deleteNotificationChannel(old);
        nm.createNotificationChannel(quiet(CH_LESSONS, "Lessons", NotificationManager.IMPORTANCE_DEFAULT));
        nm.createNotificationChannel(quiet(CH_PRESENCE, "Attendance check", NotificationManager.IMPORTANCE_HIGH));
        nm.createNotificationChannel(quiet(CH_RECORDING, "Lesson recording", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(quiet(CH_ISERV, "IServ", NotificationManager.IMPORTANCE_DEFAULT));
    }

    private static NotificationChannel quiet(String id, String name, int importance) {
        NotificationChannel c = new NotificationChannel(id, name, importance);
        c.enableVibration(false);
        c.setVibrationPattern(new long[] { 0 });
        return c;
    }

    public static PendingIntent openApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    public static void show(Context ctx, int id, String channel, String title, String body, NotificationCompat.Action... actions) {
        ensureChannels(ctx);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(R.drawable.ic_stat_lessn)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .setVibrate(new long[] { 0 })
            .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_LIGHTS)
            .setPriority(CH_PRESENCE.equals(channel) ? NotificationCompat.PRIORITY_HIGH : NotificationCompat.PRIORITY_DEFAULT);
        for (NotificationCompat.Action a : actions) b.addAction(a);
        try {
            NotificationManagerCompat.from(ctx).notify(id, b.build());
        } catch (SecurityException ignored) {
            // notification permission not granted
        }
    }
}
