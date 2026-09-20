package com.pw.examshield;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

/**
 * PW Exam Shield - Native Android Activity
 * Enforces OS-level Anti-Screenshot & Screen Recording Protection (FLAG_SECURE).
 * When FLAG_SECURE is set:
 *  1. Android prevents screenshots (Power + Vol Down displays "Can't take screenshot").
 *  2. Screen recorders (AZ, Mobizen, system recorder) record a pitch-black screen.
 *  3. In the Recent Apps (task switcher), the app preview is completely obscured.
 *  4. Secondary display projection / casting is blocked.
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // ENFORCE NATIVE OS-LEVEL ANTI-SCREENSHOT & SCREEN RECORDING BLOCK
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
        super.onCreate(savedInstanceState);
    }
}
