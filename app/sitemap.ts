import type {MetadataRoute} from "next";
export default function sitemap():MetadataRoute.Sitemap{
const urls=["","/vision","/technology","/rylo","/transparency","/status"];
return urls.map((path)=>({url:"https://orrylo.com"+(path||"/"),lastModified:new Date("2026-11-21T00:00:00Z"),changeFrequency:path?"monthly":"weekly",priority:path?0.7:1}));
}