package com.taizhang.sim;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 禁用 WebView 内置缩放（双击空白处放大、双指缩放），三维场景缩放由应用内动画控制
        try {
            WebView wv = getBridge().getWebView();
            WebSettings s = wv.getSettings();
            s.setSupportZoom(false);
            s.setBuiltInZoomControls(false);
            s.setDisplayZoomControls(false);
        } catch (Exception ignored) {
        }
    }
}
