// AUTO-GENERATED from gstack/ios-qa/templates/DebugOverlay.swift.template
//
// DebugOverlay — on-device visual presence. Animated brand-colored border +
// agent attribution chip + (optional) recording watermark. Renders above
// sheets, alerts, and modals via a dedicated UIWindow with high windowLevel.
//
// Everything in this file is gated #if DEBUG and gone in Release.

#if DEBUG && canImport(UIKit)

import SwiftUI
import UIKit

@MainActor
public final class DebugOverlayWindow {
    public static let shared = DebugOverlayWindow()

    private var window: UIWindow?

    public func install(recording: Bool = false) {
        guard window == nil else { return }
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }

        let w = PassThroughWindow(windowScene: scene)
        w.windowLevel = .alert + 1
        w.backgroundColor = .clear
        w.isUserInteractionEnabled = false

        let host = UIHostingController(rootView: OverlayRoot(recording: recording))
        host.view.backgroundColor = .clear
        w.rootViewController = host
        w.isHidden = false

        window = w
    }

    public func setAttribution(_ identity: String) {
        OverlayAttributionState.shared.identity = identity
    }
}

/// A window that lets touches pass through to underlying windows.
private final class PassThroughWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let view = super.hitTest(point, with: event)
        return view == rootViewController?.view ? nil : view
    }
}

@MainActor
final class OverlayAttributionState: ObservableObject {
    static let shared = OverlayAttributionState()
    @Published var identity: String = "Claude Code (local)"
}

private struct OverlayRoot: View {
    @StateObject private var attribution = OverlayAttributionState.shared
    let recording: Bool

    var body: some View {
        ZStack {
            // Animated brand border. Core Animation spins it in the render
            // server; the app draws nothing per frame (see AnimatedBorderView).
            AnimatedBorder()
                .ignoresSafeArea()

            // Attribution chip (top safe area)
            VStack {
                HStack {
                    Spacer()
                    Text("Driven by \(attribution.identity)")
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(
                            Capsule().fill(BrandColor.accent.opacity(0.85))
                        )
                        .padding(.trailing, 12)
                        .padding(.top, 8)
                    Spacer().frame(width: 0)
                }
                Spacer()
            }

            // Recording watermark (diagonal, bottom-right)
            if recording {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Text("AGENT DEMO")
                            .font(.system(size: 10, weight: .heavy, design: .monospaced))
                            .foregroundColor(.red.opacity(0.7))
                            .rotationEffect(.degrees(-30))
                            .padding(.trailing, 16)
                            .padding(.bottom, 30)
                    }
                }
            }
        }
        .allowsHitTesting(false)
    }
}

private struct AnimatedBorder: UIViewRepresentable {
    func makeUIView(context: Context) -> AnimatedBorderView { AnimatedBorderView() }
    func updateUIView(_ uiView: AnimatedBorderView, context: Context) {}
}

/// The sweeping brand border. Animating an AngularGradient's angle in SwiftUI
/// re-shades the whole screen-sized gradient on the CPU every frame (a full core
/// on an iPad simulator, forever). Here a conic gradient is rasterized once,
/// masked to the border stroke, and rotated by a repeating transform animation
/// that the render server runs without waking the app.
final class AnimatedBorderView: UIView {
    private static let spinKey = "gstack.debugOverlay.spin"
    private let gradient = CAGradientLayer()
    private let borderMask = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        let accent = UIColor(BrandColor.accent)
        gradient.type = .conic
        gradient.startPoint = CGPoint(x: 0.5, y: 0.5)
        gradient.endPoint = CGPoint(x: 1, y: 0.5)
        gradient.colors = [0.0, 0.8, 0.0].map { accent.withAlphaComponent($0).cgColor }
        gradient.shouldRasterize = true
        layer.addSublayer(gradient)
        borderMask.fillColor = nil
        borderMask.strokeColor = UIColor.black.cgColor
        borderMask.lineWidth = 4
        layer.mask = borderMask
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        // A square covering the view at any rotation angle.
        let side = (bounds.width * bounds.width + bounds.height * bounds.height).squareRoot()
        gradient.bounds = CGRect(x: 0, y: 0, width: side, height: side)
        gradient.position = CGPoint(x: bounds.midX, y: bounds.midY)
        gradient.rasterizationScale = window?.screen.scale ?? UIScreen.main.scale
        borderMask.frame = bounds
        borderMask.path = UIBezierPath(roundedRect: bounds.insetBy(dx: 2, dy: 2), cornerRadius: 16).cgPath
        CATransaction.commit()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        // Animations are dropped when the view leaves its window; restart on return.
        guard window != nil, gradient.animation(forKey: Self.spinKey) == nil else { return }
        let spin = CABasicAnimation(keyPath: "transform.rotation.z")
        spin.fromValue = 0
        spin.toValue = 2 * Double.pi
        spin.duration = 2
        spin.repeatCount = .infinity
        spin.isRemovedOnCompletion = false
        gradient.add(spin, forKey: Self.spinKey)
    }
}

private enum BrandColor {
    // gstack brand color — resolved from DESIGN.md when codegen runs.
    // Default falls back to a deep blue.
    static let accent = Color(red: 0.0, green: 0.46, blue: 1.0)
}

#endif // DEBUG && canImport(UIKit)
