export default async function handler(req, res) {
  return res.status(410).json({ message: "init-db endpoint disabled" });
}
