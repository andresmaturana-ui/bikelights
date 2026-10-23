package cl.andresmaturana.senalizador;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin de voz propio de la app
        registerPlugin(VozPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
