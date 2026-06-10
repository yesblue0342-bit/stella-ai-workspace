export default async function handler(req, res) {

  const query =
    req.query.q;

  const response =
    await fetch(
      "https://google.serper.dev/search",
      {
        method:"POST",
        headers:{
          "X-API-KEY":
            process.env.SERPER_API_KEY,
          "Content-Type":
            "application/json"
        },
        body:JSON.stringify({
          q:query
        })
      }
    );

  const data =
    await response.json();

  return res.status(200)
    .json(data);
}
