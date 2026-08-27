package com.taizhang.sim;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // APK 内点击「下载」链接（带 download 属性的 <a>）默认没有任何反应，
        // 这里挂上系统下载监听，真正把文件下载到设备（Android 10+ 存到公共下载目录，旧版本存应用目录）。
        try {
            getBridge().getWebView().setDownloadListener(new DownloadListener() {
                @Override
                public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                    try {
                        String filename = URLUtil.guessFileName(url, contentDisposition, mimetype);
                        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                        req.setMimeType(mimetype);
                        req.addRequestHeader("User-Agent", userAgent);
                        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        req.setTitle(filename);
                        req.setDescription(filename);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                        } else {
                            req.setDestinationInExternalFilesDir(getApplicationContext(), Environment.DIRECTORY_DOWNLOADS, filename);
                        }
                        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                        if (dm != null) dm.enqueue(req);
                    } catch (Exception ignored) {
                        // 兜底：下载失败时不再弹出空白页（保持当前页面）
                    }
                }
            });
        } catch (Exception ignored) {
            // WebView 尚未初始化时忽略
        }
    }
}
