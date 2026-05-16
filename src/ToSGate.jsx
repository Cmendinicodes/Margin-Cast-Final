import { useState, useEffect } from "react";

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=DM+Sans:wght@300;400;500&display=swap');

  .tor-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(0,0,0,0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    font-family: 'DM Sans', sans-serif;
  }
  .tor-modal {
    background: #0e0c09;
    border: 1px solid #7a6435;
    border-radius: 12px;
    width: 100%;
    max-width: 560px;
    overflow: hidden;
  }
  .tor-header {
    padding: 1rem 1.25rem 0.75rem;
    border-bottom: 1px solid #2a2416;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .tor-logo {
    width: 28px;
    height: 28px;
    border: 1px solid #7a6435;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .tor-logo span {
    font-family: 'Playfair Display', serif;
    font-size: 12px;
    color: #c9a84c;
    font-weight: 600;
  }
  .tor-title {
    font-family: 'Playfair Display', serif;
    font-size: 14px;
    color: #e8d5a0;
    font-weight: 600;
    margin: 0 0 1px;
  }
  .tor-sub {
    font-size: 10px;
    color: #4a3d22;
    margin: 0;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .tor-agree-bar {
    padding: 0.65rem 1.25rem;
    border-bottom: 1px solid #2a2416;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0a0805;
  }
  .tor-agree-bar input[type=checkbox] {
    accent-color: #c9a84c;
    width: 13px;
    height: 13px;
    flex-shrink: 0;
    cursor: pointer;
  }
  .tor-agree-bar label {
    font-size: 11px;
    color: #6b5e3e;
    line-height: 1.4;
    cursor: pointer;
  }
  .tor-agree-bar label a {
    color: #c9a84c;
    text-decoration: none;
  }
  .tor-body {
    padding: 0.75rem 1.25rem 0.85rem;
    max-height: 240px;
    overflow-y: auto;
  }
  .tor-body::-webkit-scrollbar { width: 3px; }
  .tor-body::-webkit-scrollbar-track { background: #1a1510; }
  .tor-body::-webkit-scrollbar-thumb { background: #4a3d22; border-radius: 2px; }
  .tor-section { margin-bottom: 0.75rem; }
  .tor-section-title {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #c9a84c;
    margin: 0 0 3px;
    font-weight: 500;
  }
  .tor-section p {
    font-size: 11px;
    color: #6b5e3e;
    line-height: 1.55;
    margin: 0;
  }
  .tor-divider {
    border: none;
    border-top: 1px solid #1a1510;
    margin: 0.6rem 0;
  }
  .tor-footer {
    padding: 0.75rem 1.25rem;
    border-top: 1px solid #1e1a12;
    display: flex;
    gap: 8px;
  }
  .tor-btn {
    flex: 1;
    padding: 8px;
    border-radius: 5px;
    font-family: 'DM Sans', sans-serif;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    border: none;
  }
  .tor-btn-decline {
    background: #1a1510;
    color: #4a3d22;
    border: 1px solid #2a2416;
  }
  .tor-btn-decline:hover { border-color: #4a3d22; color: #6b5e3e; }
  .tor-btn-accept { background: #c9a84c; color: #0e0c09; }
  .tor-btn-accept:hover { background: #e8c96a; }
  .tor-btn-accept:disabled {
    background: #2a2416;
    color: #3a3220;
    cursor: not-allowed;
  }
`;

const TOS_KEY = "tos_accepted_v1";

export default function ToSGate({ children }) {
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(TOS_KEY) === "true") {
      setAccepted(true);
    }
  }, []);

  function handleAccept() {
    localStorage.setItem(TOS_KEY, "true");
    setAccepted(true);
  }

  function handleDecline() {
    setDeclined(true);
  }

  if (accepted) return children;

  return (
    <>
      <style>{styles}</style>
      <div className="tor-overlay">
        <div className="tor-modal" role="dialog" aria-modal="true" aria-labelledby="tor-title">

          <div className="tor-header">
            <div className="tor-logo"><span>MC</span></div>
            <div>
              <p className="tor-title" id="tor-title">Terms of Service</p>
              <p className="tor-sub">Margin-Cast &mdash; margincast.com &mdash; Effective May 2026</p>
            </div>
          </div>

          <div className="tor-agree-bar">
            <input
              type="checkbox"
              id="agree-check"
              checked={checked}
              onChange={e => setChecked(e.target.checked)}
              disabled={declined}
            />
            <label htmlFor="agree-check">
              I have read and agree to these Terms. I understand all valuations are informational only and do not constitute financial advice.
            </label>
          </div>

          <div className="tor-body">
            {declined && (
              <p style={{ fontSize: 11, color: "#a04040", marginBottom: "0.75rem" }}>
                You must accept the Terms of Service to access Margin-Cast.
              </p>
            )}

            <div className="tor-section">
              <p className="tor-section-title">1. Acceptance</p>
              <p>By accessing or using Margin-Cast ("the Platform"), you agree to be bound by these Terms. If you do not agree, you may not access the Platform.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">2. Not financial advice</p>
              <p>All content, valuations, models, and outputs — including DCF, DDM, EV/EBITDA, P/E, P/S, P/B, Graham Number, PEG, and Quant Prediction analyses — are for informational and educational purposes only. Nothing constitutes financial, investment, legal, or tax advice. Consult a qualified advisor before making investment decisions.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">3. No guarantee of accuracy</p>
              <p>Valuations and model outputs are based on publicly available data and user-supplied assumptions. They may be incomplete, inaccurate, or outdated. The Platform makes no representations as to accuracy or fitness for any purpose.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">4. Limitation of liability</p>
              <p>To the fullest extent permitted by law, Margin-Cast and its operators shall not be liable for any direct, indirect, incidental, consequential, or punitive damages arising from your use of the Platform, including any investment losses.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">5. Credits & payments</p>
              <p>Credits are consumed per analysis. All purchases are final and non-refundable unless required by law. Promotional credits (guest and executive codes) have no cash value and may be revoked at any time without notice.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">6. Acceptable use</p>
              <p>You agree not to: (a) use the Platform unlawfully; (b) scrape or redistribute outputs commercially; (c) reverse-engineer or circumvent any security or credit system; (d) share account access or codes with unauthorized parties.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">7. Intellectual property</p>
              <p>All Platform design, code, models, and branding are the property of Margin-Cast. You are granted a limited, non-exclusive license for personal, non-commercial use only.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">8. Third-party data</p>
              <p>Market data is sourced from third-party providers including Yahoo Finance. The Platform is not affiliated with any data provider. Accuracy of third-party data is not guaranteed.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">9. Changes to terms</p>
              <p>We reserve the right to modify these Terms at any time. Continued use constitutes acceptance of updated Terms.</p>
            </div>
            <hr className="tor-divider" />

            <div className="tor-section">
              <p className="tor-section-title">10. Governing law</p>
              <p>These Terms are governed by the laws of the State of New York, without regard to conflict of law principles.</p>
            </div>
          </div>

          <div className="tor-footer">
            <button className="tor-btn tor-btn-decline" onClick={handleDecline}>Decline</button>
            <button
              className="tor-btn tor-btn-accept"
              onClick={handleAccept}
              disabled={!checked || declined}
            >
              Accept & Enter
            </button>
          </div>

        </div>
      </div>
    </>
  );
}
