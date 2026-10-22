import AVFoundation
import Capacitor
import Speech
import UIKit

// Controlador principal: registra el plugin de voz propio de la app
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VozPlugin())
    }
}

// Reconocimiento de voz nativo. A diferencia de Safari, la sesión de audio usa
// mixWithOthers: el micrófono escucha sin pausar Spotify, y se reanuda solo
// después de una llamada.
@objc(VozPlugin)
public class VozPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VozPlugin"
    public let jsName = "Voz"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
    ]

    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var wanted = false
    private var interruption = false
    private var segment = 0
    private var restartWork: DispatchWorkItem?

    override public func load() {
        VozPlugin.configureSession()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(interrupted(_:)),
                           name: AVAudioSession.interruptionNotification, object: nil)
        center.addObserver(self, selector: #selector(routeChanged(_:)),
                           name: AVAudioSession.routeChangeNotification, object: nil)
        center.addObserver(self, selector: #selector(mediaReset),
                           name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        center.addObserver(self, selector: #selector(becameActive),
                           name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    // Grabar y reproducir mezclado con la música; los sonidos de la app salen por el parlante
    static func configureSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default,
                                 options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothA2DP])
        try? session.setActive(true)
    }

    @objc func start(_ call: CAPPluginCall) {
        let lang = call.getString("lang") ?? "es-CL"
        authorize { error in
            DispatchQueue.main.async {
                if let error {
                    call.reject(error)
                    return
                }
                self.recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang))
                    ?? SFSpeechRecognizer(locale: Locale(identifier: "es-ES"))
                self.wanted = true
                do {
                    try self.begin()
                    call.resolve()
                } catch {
                    self.wanted = false
                    call.reject("No se pudo abrir el micrófono: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.wanted = false
            self.restartWork?.cancel()
            self.end()
            self.notifyListeners("state", data: ["listening": false])
            call.resolve()
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? true
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    private func authorize(_ done: @escaping (String?) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                done("Sin permiso de reconocimiento de voz")
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                done(granted ? nil : "Sin permiso de micrófono")
            }
        }
    }

    private func begin() throws {
        end()
        guard let recognizer, recognizer.isAvailable else {
            scheduleRestart(after: 2)
            return
        }
        VozPlugin.configureSession()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        if #available(iOS 16, *) {
            request.addsPunctuation = false
        }
        self.request = request

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            scheduleRestart(after: 1)
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        engine.prepare()
        try engine.start()

        segment += 1
        let current = segment
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result {
                self.notifyListeners("result", data: [
                    "text": result.bestTranscription.formattedString,
                    "segment": current,
                    "final": result.isFinal,
                ])
            }
            if error != nil || result?.isFinal == true {
                DispatchQueue.main.async {
                    if current == self.segment { self.scheduleRestart(after: 0.2) }
                }
            }
        }
        notifyListeners("state", data: ["listening": true])

        // Cada tarea de reconocimiento tiene un límite de tiempo: se renueva antes
        scheduleRestart(after: 50)
    }

    private func end() {
        task?.cancel()
        task = nil
        request?.endAudio()
        request = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
    }

    private func scheduleRestart(after seconds: Double) {
        restartWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.wanted, !self.interruption else { return }
            do {
                try self.begin()
            } catch {
                self.scheduleRestart(after: 1)
            }
        }
        restartWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    // Llamadas, Siri o alarmas: se suelta el micrófono y se retoma al terminar
    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        DispatchQueue.main.async {
            self.interruption = type == .began
            if type == .began {
                self.restartWork?.cancel()
                self.end()
                self.notifyListeners("state", data: ["listening": false])
            } else if self.wanted {
                self.scheduleRestart(after: 0.5)
            }
        }
    }

    // Audífonos conectados o desconectados: cambia el formato del micrófono
    @objc private func routeChanged(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: raw),
              reason == .newDeviceAvailable || reason == .oldDeviceUnavailable else { return }
        DispatchQueue.main.async {
            if self.wanted { self.scheduleRestart(after: 0.3) }
        }
    }

    @objc private func mediaReset() {
        DispatchQueue.main.async {
            VozPlugin.configureSession()
            if self.wanted { self.scheduleRestart(after: 0.5) }
        }
    }

    @objc private func becameActive() {
        DispatchQueue.main.async {
            // Si iOS no avisó el fin de la interrupción, se retoma al volver a la app
            self.interruption = false
            if self.wanted && !self.engine.isRunning { self.scheduleRestart(after: 0.2) }
        }
    }
}
