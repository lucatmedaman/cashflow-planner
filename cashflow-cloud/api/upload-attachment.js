// Server-side proxy naar Airtable's Upload Attachment endpoint. Dat leeft op
// een ANDER host (content.airtable.com) dan de generieke REST-proxy
// (api.airtable.com via api/airtable/[...path].js), vandaar een apart
// bestand. Token leeft enkel server-side (AIRTABLE_TOKEN), nooit in de browser.
//
// Verwacht een POST met JSON body:
//   { recordId, fieldId, filename, contentType, file }
// waarbij "file" de base64-inhoud van het bestand is (zonder data:-prefix).

const BASE_ID = "appnK89Zxu17tWovZ";

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) {
    res.status(500).json({ error: { message: "AIRTABLE_TOKEN ontbreekt in de server-omgevingsvariabelen." } });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: { message: "Enkel POST wordt ondersteund." } });
    return;
  }

  const { recordId, fieldId, filename, contentType, file } = req.body || {};
  if (!recordId || !fieldId || !filename || !file) {
    res.status(400).json({ error: { message: "recordId, fieldId, filename en file zijn verplicht." } });
    return;
  }

  try {
    const uploadUrl = `https://content.airtable.com/v0/${BASE_ID}/${recordId}/${fieldId}/uploadAttachment`;
    const airtableRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType: contentType || "application/octet-stream",
        filename,
        file,
      }),
    });
    const data = await airtableRes.json().catch(() => ({}));
    res.status(airtableRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: { message: `Upload naar Airtable mislukt: ${err.message}` } });
  }
}
