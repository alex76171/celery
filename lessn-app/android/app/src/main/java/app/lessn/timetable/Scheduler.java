package app.lessn.timetable;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Keeps a list of upcoming events (reminders, DND on/off, attendance checks) in SharedPreferences
 * and always has exactly one alarm set for the next one.
 */
public final class Scheduler {
    static final String PREFS = "lessn_native";
    static final String ACTION_FIRE = "app.lessn.timetable.FIRE";

    private Scheduler() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONArray events(Context ctx) {
        try { return new JSONArray(prefs(ctx).getString("events", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    static void saveEvents(Context ctx, JSONArray arr) {
        prefs(ctx).edit().putString("events", arr.toString()).apply();
    }

    static PendingIntent firePi(Context ctx) {
        Intent i = new Intent(ctx, EventReceiver.class).setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(ctx, 1, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** Sets an alarm for the earliest future event (or cancels if none). */
    static void scheduleNext(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = firePi(ctx);
        am.cancel(pi);
        JSONArray arr = events(ctx);
        long next = Long.MAX_VALUE;
        long now = System.currentTimeMillis();
        for (int i = 0; i < arr.length(); i++) {
            long at = arr.optJSONObject(i).optLong("at");
            if (at > now - 60_000 && at < next) next = at;
        }
        if (next == Long.MAX_VALUE) return;
        long when = Math.max(next, now + 1000);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when, pi);
        }
    }

    /** Takes every event that is due, removes it from the list and returns them. */
    static JSONArray takeDue(Context ctx) {
        JSONArray arr = events(ctx);
        JSONArray keep = new JSONArray();
        JSONArray due = new JSONArray();
        long now = System.currentTimeMillis();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject e = arr.optJSONObject(i);
            long at = e.optLong("at");
            if (at <= now + 15_000) {
                if (at > now - 20 * 60_000) due.put(e); // drop events that are way too old
            } else keep.put(e);
        }
        saveEvents(ctx, keep);
        return due;
    }

    static boolean dndAccess(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm.isNotificationPolicyAccessGranted();
    }

    static void setDnd(Context ctx, boolean on) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (!nm.isNotificationPolicyAccessGranted()) return;
        SharedPreferences p = prefs(ctx);
        try {
            if (on) {
                if (nm.getCurrentInterruptionFilter() == NotificationManager.INTERRUPTION_FILTER_ALL) {
                    nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY);
                    p.edit().putBoolean("dndByUs", true).apply();
                }
            } else if (p.getBoolean("dndByUs", false)) {
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL);
                p.edit().putBoolean("dndByUs", false).apply();
            }
        } catch (SecurityException ignored) { }
    }

    static void logPresence(Context ctx, String date, String status) {
        SharedPreferences p = prefs(ctx);
        try {
            JSONObject log = new JSONObject(p.getString("presence", "{}"));
            JSONObject entry = new JSONObject();
            entry.put("status", status);
            entry.put("t", System.currentTimeMillis());
            log.put(date, entry);
            p.edit().putString("presence", log.toString()).apply();
        } catch (Exception ignored) { }
    }

    static void logCheckin(Context ctx, String exam, String answer) {
        SharedPreferences p = prefs(ctx);
        try {
            JSONObject log = new JSONObject(p.getString("checkins", "{}"));
            log.put(exam, answer);
            p.edit().putString("checkins", log.toString()).apply();
        } catch (Exception ignored) { }
    }

    /** Recordings made in the background, waiting for the app to summarize them. */
    static void addDoneRecording(Context ctx, String path, long duration, String meta) {
        SharedPreferences p = prefs(ctx);
        try {
            JSONArray arr = new JSONArray(p.getString("recDone", "[]"));
            JSONObject o = new JSONObject();
            o.put("path", path); o.put("duration", duration); o.put("meta", meta); o.put("t", System.currentTimeMillis());
            arr.put(o);
            p.edit().putString("recDone", arr.toString()).apply();
        } catch (Exception ignored) { }
    }
}
