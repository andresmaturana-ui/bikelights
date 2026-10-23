package cl.andresmaturana.senalizador;

import android.Manifest;
import android.view.WindowManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

// Reconocimiento de voz sin conexión con Vosk. A diferencia del servicio de voz
// de Google, no suena un pitido cada vez que el micrófono se reactiva, escucha
// continuo y no pide el foco de audio, así que la música sigue sonando.
@CapacitorPlugin(
    name = "Voz",
    permissions = @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone")
)
public class VozPlugin extends Plugin implements RecognitionListener {
    private static final float SAMPLE_RATE = 16000f;

    private Model model;
    private boolean loadingModel = false;
    private final List<PluginCall> waiting = new ArrayList<>();
    private SpeechService service;
    private Recognizer recognizer;
    private String grammar;
    private int segment = 0;

    @PluginMethod
    public void start(PluginCall call) {
        grammar = buildGrammar(call.getArray("phrases"));
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermission");
            return;
        }
        withModel(call);
    }

    @PermissionCallback
    private void micPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            withModel(call);
        } else {
            call.reject("Sin permiso de micrófono");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        end();
        notifyState(false);
        call.resolve();
    }

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = call.getBoolean("on", true);
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // El modelo viene en los assets de la app y se copia al almacenamiento interno la primera vez
    private void withModel(PluginCall call) {
        if (model != null) {
            begin(call);
            return;
        }
        waiting.add(call);
        if (loadingModel) return;
        loadingModel = true;
        StorageService.unpack(getContext(), "model-es", "model",
            (loaded) -> {
                model = loaded;
                loadingModel = false;
                for (PluginCall c : drain()) begin(c);
            },
            (error) -> {
                loadingModel = false;
                for (PluginCall c : drain()) c.reject("No se pudo cargar el modelo de voz: " + error.getMessage());
            });
    }

    private List<PluginCall> drain() {
        List<PluginCall> calls = new ArrayList<>(waiting);
        waiting.clear();
        return calls;
    }

    private void begin(PluginCall call) {
        end();
        try {
            recognizer = grammar != null
                ? new Recognizer(model, SAMPLE_RATE, grammar)
                : new Recognizer(model, SAMPLE_RATE);
            service = new SpeechService(recognizer, SAMPLE_RATE);
            service.startListening(this);
            segment++;
            notifyState(true);
            call.resolve();
        } catch (IOException | RuntimeException e) {
            end();
            call.reject("No se pudo abrir el micrófono: " + e.getMessage());
        }
    }

    private void end() {
        if (service != null) {
            service.stop();
            service.shutdown();
            service = null;
        }
        if (recognizer != null) {
            recognizer.close();
            recognizer = null;
        }
    }

    // Solo se buscan las palabras de los comandos: reconoce mejor y no confunde ruido con órdenes
    private static String buildGrammar(JSArray phrases) {
        if (phrases == null || phrases.length() == 0) return null;
        Set<String> words = new LinkedHashSet<>();
        try {
            for (int i = 0; i < phrases.length(); i++) {
                String p = phrases.getString(i).trim().toLowerCase();
                if (!p.isEmpty()) words.add(p);
            }
        } catch (JSONException e) {
            return null;
        }
        if (words.isEmpty()) return null;
        JSONArray list = new JSONArray(words);
        list.put("[unk]");
        return list.toString();
    }

    private void emit(String hypothesis, String key, boolean isFinal) {
        String text;
        try {
            text = new JSONObject(hypothesis).optString(key, "");
        } catch (JSONException e) {
            return;
        }
        text = text.replace("[unk]", "").trim();
        if (!text.isEmpty()) {
            JSObject data = new JSObject();
            data.put("text", text);
            data.put("segment", segment);
            data.put("final", isFinal);
            notifyListeners("result", data);
        }
        if (isFinal) segment++;
    }

    private void notifyState(boolean listening) {
        JSObject data = new JSObject();
        data.put("listening", listening);
        notifyListeners("state", data);
    }

    @Override
    public void onPartialResult(String hypothesis) {
        emit(hypothesis, "partial", false);
    }

    @Override
    public void onResult(String hypothesis) {
        emit(hypothesis, "text", true);
    }

    @Override
    public void onFinalResult(String hypothesis) {
        emit(hypothesis, "text", true);
    }

    @Override
    public void onError(Exception e) {
        end();
        notifyState(false);
    }

    @Override
    public void onTimeout() {
        end();
        notifyState(false);
    }

    @Override
    protected void handleOnDestroy() {
        end();
        if (model != null) model.close();
    }
}
