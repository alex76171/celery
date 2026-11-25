package app.lessn.timetable;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import org.json.JSONObject;

/** In-app IServ browser: signs in automatically and restyles the pages. */
public class IServActivity extends Activity {
    private WebView web;
    private ProgressBar bar;
    private ValueCallback<Uri[]> fileCallback;
    private String host;
    private String user;
    private String pass;
    private String css;
    private boolean triedLogin = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent in = getIntent();
        String url = in.getStringExtra("url");
        host = Uri.parse(url).getHost();
        user = in.getStringExtra("username");
        pass = in.getStringExtra("password");
        css = in.getStringExtra("css");
        int bg = Color.parseColor(in.getStringExtra("bg") != null ? in.getStringExtra("bg") : "#ffffff");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(bg);
        web = new WebView(this);
        web.setBackgroundColor(bg);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(bar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 8));
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets s = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime());
            v.setPadding(s.left, s.top, s.right, s.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setLoadWithOverviewMode(true);
        ws.setUseWideViewPort(true);
        ws.setBuiltInZoomControls(true);
        ws.setDisplayZoomControls(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                String scheme = u.getScheme();
                if (("http".equals(scheme) || "https".equals(scheme)) && host.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String u) {
                inject();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                bar.setProgress(p);
                bar.setVisibility(p >= 100 ? android.view.View.GONE : android.view.View.VISIBLE);
                if (p > 60) inject();
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), 9);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.setDownloadListener((dUrl, ua, disposition, mime, len) -> {
            try {
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(dUrl));
                r.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(dUrl));
                r.addRequestHeader("User-Agent", ua);
                String name = URLUtil.guessFileName(dUrl, disposition, mime);
                r.setTitle(name);
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            } catch (Exception ignored) { }
        });
        web.loadUrl(url);
    }

    private void inject() {
        try {
            String js = "(function(){try{"
                + "if(!document.getElementById('lessn-style')){var s=document.createElement('style');s.id='lessn-style';s.textContent=" + JSONObject.quote(css == null ? "" : css) + ";(document.head||document.documentElement).appendChild(s);}"
                + "var m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';document.head&&document.head.appendChild(m);}m.content='width=device-width, initial-scale=1';"
                + "}catch(e){}})();";
            web.evaluateJavascript(js, null);
            if (!triedLogin && user != null && pass != null) {
                String login = "(function(){var u=document.querySelector('input[name=_username]'),p=document.querySelector('input[name=_password]');"
                    + "if(!u||!p)return 'no';u.value=" + JSONObject.quote(user) + ";p.value=" + JSONObject.quote(pass) + ";"
                    + "['input','change'].forEach(function(t){u.dispatchEvent(new Event(t,{bubbles:true}));p.dispatchEvent(new Event(t,{bubbles:true}));});"
                    + "var f=p.form;if(f){var b=f.querySelector('[type=submit]');if(b)b.click();else f.submit();}return 'ok';})();";
                web.evaluateJavascript(login, r -> { if (r != null && r.contains("ok")) triedLogin = true; });
            }
        } catch (Exception ignored) { }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == 9 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
