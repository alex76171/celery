package app.lessn.timetable;

import android.graphics.Canvas;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.drawable.Drawable;

/** Background that is one color on the upper half and another on the lower half (status bar vs. navigation bar). */
final class TwoTone extends Drawable {
    private final Paint top = new Paint();
    private final Paint bottom = new Paint();

    TwoTone(int topColor, int bottomColor) {
        top.setColor(topColor);
        bottom.setColor(bottomColor);
    }

    @Override
    public void draw(Canvas c) {
        Rect b = getBounds();
        int mid = b.top + b.height() / 2;
        c.drawRect(b.left, b.top, b.right, mid, top);
        c.drawRect(b.left, mid, b.right, b.bottom, bottom);
    }

    @Override public void setAlpha(int alpha) { }
    @Override public void setColorFilter(ColorFilter cf) { }
    @Override public int getOpacity() { return PixelFormat.OPAQUE; }
}
