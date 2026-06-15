import authHandler from "./auth.js";
export default async function handler(req, res){
  req.body = { ...(req.body||{}), mode: "signup" };
  return authHandler(req, res);
}
