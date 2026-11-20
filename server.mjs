import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3000);
const paths=new Map([
 ["/",["public/index.html","text/html; charset=utf-8"]],
 ["/favicon.svg",["public/favicon.svg","image/svg+xml"]],
 ["/logo.png",["public/logo.png","image/png"]],
 ["/logo",["public/logo.png","image/png"]],
 ["/robots.txt",["public/robots.txt","text/plain; charset=utf-8"]],
 ["/sitemap.xml",["public/sitemap.xml","application/xml; charset=utf-8"]]
]);
createServer(async(req,res)=>{
 const path=new URL(req.url||"/","http://localhost").pathname;
 const headers={"X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","X-Frame-Options":"DENY","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
 if(path==="/healthz"){res.writeHead(200,{...headers,"Content-Type":"application/json"});return res.end(JSON.stringify({status:"ok",service:"orrylo-home"}))}
 if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405,headers);return res.end()}
 const r=paths.get(path);if(!r){res.writeHead(404,headers);return res.end("Not found")}
 try{const [file,type]=r;const buf=await readFile(join(root,file));res.writeHead(200,{...headers,"Content-Type":type});res.end(req.method==="HEAD"?"":buf)}
 catch{res.writeHead(500,headers);res.end("Server error")}
}).listen(port,"0.0.0.0",()=>console.log("Orrylo home on "+port));