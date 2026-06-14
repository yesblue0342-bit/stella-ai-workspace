import authHandler from "../auth.js";
export default async function handler(req, res){
  req.body = { ...(req.body||{}), mode: "login" };
  return authHandler(req, res);
}
