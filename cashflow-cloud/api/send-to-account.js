// api/send-to-accountant.js
//
// Verstuurt een factuur-PDF automatisch als bijlage naar het boekhouding-
// e-mailadres (bv. Exact Online) via Resend (resend.com).
//
// Vereiste environment variable (Vercel, server-only):
//   RESEND_API_KEY   — API-key uit resend.com (Dashboard > API Keys)
//
// Aanbevolen (niet strikt verplicht): verifieer je eigen domein bij Resend
// (Dashboard > Domains) en gebruik dat als afzender via de env var
// RESEND_FROM_EMAIL, bv. "boekhouding@medaman.be" — zonder een geverifieerd
// domein moet je verzenden vanaf Resend's testadres
// (onboarding@resend.dev), wat vaker in spam terechtkomt bij de
// ontvanger.
//
// Wordt aangeroepen vanuit de app zelf (App.jsx, na een geslaagde
// UBL/PDF-import) met: { to, subject, text, filename, pdfBase64 }.

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Alleen POST wordt ondersteund." });
      return;
    }
    if (!process.env.RESEND_API_KEY) {
      res.status(500).json({ error: "RESEND_API_KEY ontbreekt in de server-omgevingsvariabelen." });
      return;
    }

    const { to, subject, text, filename, pdfBase64 } = req.body || {};
    if (!to || !filename || !pdfBase64) {
      res.status(422).json({ error: "Ontbrekende velden: 'to', 'filename' en 'pdfBase64' zijn verplicht." });
      return;
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `Cashflow Planner <${fromEmail}>`,
        to: [to],
        subject: subject || `Factuur — ${filename}`,
        text: text || `Bijgevoegd: ${filename}`,
        attachments: [
          {
            filename,
            content: pdfBase64, // Resend verwacht base64, zonder data-URL-prefix
          },
        ],
      }),
    });

    const data = await resendRes.json();
    if (!resendRes.ok) {
      console.error("send-to-accountant: Resend weigerde de mail:", data);
      res.status(502).json({ error: "Resend weigerde de e-mail.", detail: data });
      return;
    }

    res.status(200).json({ status: "ok", resendId: data.id });
  } catch (err) {
    console.error("send-to-accountant crashed:", err);
    res.status(500).json({ error: err.message });
  }
}
