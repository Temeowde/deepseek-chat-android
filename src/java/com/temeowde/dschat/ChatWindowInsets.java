package com.temeowde.dschat;

import android.app.Activity;
import android.graphics.Insets;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsAnimation;

import java.util.List;

/** Positions the chat WebView inside the system bars and the animated IME. Android 11+. */
public final class ChatWindowInsets extends WindowInsetsAnimation.Callback {
    private final View root;
    private WindowInsets finalInsets;
    private WindowInsetsAnimation imeAnimation;

    public static void install(Activity activity, View root) {
        activity.getWindow().setDecorFitsSystemWindows(false);
        ChatWindowInsets controller = new ChatWindowInsets(root);
        root.setWindowInsetsAnimationCallback(controller);
        root.setOnApplyWindowInsetsListener(controller::onApply);
    }

    private ChatWindowInsets(View root) {
        super(DISPATCH_MODE_STOP);
        this.root = root;
    }

    private WindowInsets onApply(View view, WindowInsets insets) {
        finalInsets = insets;
        if (imeAnimation == null) {
            applyPadding(insets);
        }
        // This view has laid out the WebView around these insets.
        return WindowInsets.CONSUMED;
    }

    @Override
    public void onPrepare(WindowInsetsAnimation animation) {
        if ((animation.getTypeMask() & WindowInsets.Type.ime()) != 0) {
            imeAnimation = animation;
        }
    }

    @Override
    public WindowInsets onProgress(WindowInsets insets, List<WindowInsetsAnimation> running) {
        if (imeAnimation != null) {
            applyPadding(insets);
        }
        return insets;
    }

    @Override
    public void onEnd(WindowInsetsAnimation animation) {
        if (imeAnimation == animation) {
            imeAnimation = null;
            if (finalInsets != null) {
                applyPadding(finalInsets);
            }
        }
    }

    private void applyPadding(WindowInsets insets) {
        int bars = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout();
        Insets safe = insets.getInsets(bars);
        int bottom = Math.max(safe.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom);
        if (root.getPaddingLeft() != safe.left || root.getPaddingTop() != safe.top
                || root.getPaddingRight() != safe.right || root.getPaddingBottom() != bottom) {
            root.setPadding(safe.left, safe.top, safe.right, bottom);
        }
    }
}
