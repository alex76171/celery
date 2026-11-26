package app.lessn.timetable;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

public class EventReceiver extends BroadcastReceiver {
    static final String ACTION_YES = "app.lessn.timetable.PRESENT_YES";
    static final String ACTION_NO = "app.lessn.timetable.PRESENT_NO";
    static final int PRESENCE_NOTIF = 4242;
    static final String ACTION_REC_NO = "app.lessn.timetable.REC_NO";
    static final String ACTION_CHECKIN_YES = "app.lessn.timetable.CHECKIN_YES";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        if (ACTION_YES.equals(action) || ACTION_NO.equals(action)) {
            Scheduler.logPresence(ctx, intent.getStringExtra("date"), ACTION_YES.equals(action) ? "present" : "absent");
            NotificationManagerCompat.from(ctx).cancel(PRESENCE_NOTIF);
            return;
        }
        if (ACTION_REC_NO.equals(action)) {
            NotificationManagerCompat.from(ctx).cancel(intent.getIntExtra("nid", 0));
            return;
        }
        if (ACTION_CHECKIN_YES.equals(action)) {
            Scheduler.logCheckin(ctx, intent.getStringExtra("exam"), "yes");
            NotificationManagerCompat.from(ctx).cancel(intent.getIntExtra("nid", 0));
            return;
        }
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            Scheduler.scheduleNext(ctx);
            return;
        }
        if (!Scheduler.ACTION_FIRE.equals(action)) return;

        JSONArray due = Scheduler.takeDue(ctx);
        JSONObject presence = null;
        for (int i = 0; i < due.length(); i++) {
            JSONObject e = due.optJSONObject(i);
            String type = e.optString("type");
            switch (type) {
                case "remind":
                    Notifs.showTo(ctx, e.optInt("id", (int) (e.optLong("at") / 1000)), e.optString("channel", "").isEmpty() ? Notifs.CH_LESSONS : Notifs.CH_PLANNER,
                        e.optString("title"), e.optString("body"), e.optString("open", null));
                    break;
                case "recask": askRecord(ctx, e); break;
                case "checkin": askCheckin(ctx, e); break;
                case "dndOn": Scheduler.setDnd(ctx, true); break;
                case "dndOff": Scheduler.setDnd(ctx, false); break;
                case "presence": presence = e; break;
                default:
            }
        }
        Scheduler.scheduleNext(ctx);
        if (presence != null) checkPresence(ctx, presence);
    }

    /** "Record Maths?" with a Record button that arms the recorder for the lesson (works with the screen locked). */
    private void askRecord(Context ctx, JSONObject e) {
        int nid = 6000 + (int) ((e.optLong("start") / 60000) % 1000);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        Intent arm = new Intent(ctx, RecorderService.class).setAction(RecorderService.ACTION_ARM)
            .putExtra("startAt", e.optLong("start")).putExtra("endAt", e.optLong("end"))
            .putExtra("title", e.optString("recTitle", "Lesson")).putExtra("meta", e.optString("meta", "{}")).putExtra("nid", nid);
        PendingIntent armPi = Build.VERSION.SDK_INT >= 26 ? PendingIntent.getForegroundService(ctx, nid, arm, flags) : PendingIntent.getService(ctx, nid, arm, flags);
        Intent no = new Intent(ctx, EventReceiver.class).setAction(ACTION_REC_NO).putExtra("nid", nid);
        Notifs.showTo(ctx, nid, Notifs.CH_RECASK, e.optString("title"), e.optString("body"), "recorder",
            new NotificationCompat.Action(0, e.optString("yes", "Record"), armPi),
            new NotificationCompat.Action(0, e.optString("no", "Not now"), PendingIntent.getBroadcast(ctx, nid + 1, no, flags)));
    }

    /** "Have you studied for …?" — Yes is noted, Not yet opens the AI suggestions. */
    private void askCheckin(Context ctx, JSONObject e) {
        String exam = e.optString("exam");
        int nid = 7000 + (Math.abs(exam.hashCode()) % 900);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        Intent yes = new Intent(ctx, EventReceiver.class).setAction(ACTION_CHECKIN_YES).putExtra("exam", exam).putExtra("nid", nid);
        Notifs.showTo(ctx, nid, Notifs.CH_PLANNER, e.optString("title"), e.optString("body"), "checkin:" + exam,
            new NotificationCompat.Action(0, e.optString("yes", "Yes"), PendingIntent.getBroadcast(ctx, nid, yes, flags)),
            new NotificationCompat.Action(0, e.optString("no", "Not yet"), Notifs.openApp(ctx, "checkin:" + exam)));
    }

    private void checkPresence(Context ctx, JSONObject e) {
        boolean fine = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!fine && !coarse) return;
        final PendingResult pending = goAsync();
        final LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        final AtomicBoolean done = new AtomicBoolean(false);
        final Handler h = new Handler(Looper.getMainLooper());
        final Runnable finish = () -> {
            if (done.compareAndSet(false, true)) {
                // No fresh fix: fall back to the last known location
                Location best = null;
                try {
                    for (String p : lm.getProviders(true)) {
                        Location l = lm.getLastKnownLocation(p);
                        if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                    }
                } catch (SecurityException ignored) { }
                if (best != null && System.currentTimeMillis() - best.getTime() < 30 * 60_000) evaluate(ctx, e, best);
                pending.finish();
            }
        };
        h.postDelayed(finish, 25_000);
        try {
            String provider = lm.isProviderEnabled(LocationManager.GPS_PROVIDER) && fine ? LocationManager.GPS_PROVIDER
                : LocationManager.NETWORK_PROVIDER;
            if (Build.VERSION.SDK_INT >= 30) {
                lm.getCurrentLocation(provider, null, ContextCompat.getMainExecutor(ctx), loc -> {
                    if (loc != null && done.compareAndSet(false, true)) {
                        evaluate(ctx, e, loc);
                        h.removeCallbacks(finish);
                        pending.finish();
                    }
                });
            } else {
                h.removeCallbacks(finish);
                h.post(finish);
            }
        } catch (Exception ex) {
            h.removeCallbacks(finish);
            h.post(finish);
        }
    }

    private void evaluate(Context ctx, JSONObject e, Location loc) {
        float[] dist = new float[1];
        Location.distanceBetween(loc.getLatitude(), loc.getLongitude(), e.optDouble("lat"), e.optDouble("lng"), dist);
        double radius = e.optDouble("radius", 250) + Math.min(loc.getAccuracy(), 300);
        String date = e.optString("date");
        if (dist[0] <= radius) {
            Scheduler.logPresence(ctx, date, "present");
            return;
        }
        Scheduler.logPresence(ctx, date, "away");
        Intent yes = new Intent(ctx, EventReceiver.class).setAction(ACTION_YES).putExtra("date", date);
        Intent no = new Intent(ctx, EventReceiver.class).setAction(ACTION_NO).putExtra("date", date);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        Notifs.show(ctx, PRESENCE_NOTIF, Notifs.CH_PRESENCE, e.optString("title", "Are you at school?"), e.optString("body", ""),
            new NotificationCompat.Action(0, e.optString("yes", "Yes"), PendingIntent.getBroadcast(ctx, 11, yes, flags)),
            new NotificationCompat.Action(0, e.optString("no", "No"), PendingIntent.getBroadcast(ctx, 12, no, flags)));
    }
}
