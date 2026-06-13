export default function handler(req, res) {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.status(200).send(JSON.stringify({
    name: "Stella Workspace",
    short_name: "Stella",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a"
  }));
}
