import { ROUTES, type Route } from "./config";

/** 根据请求路径查找匹配的路由，未匹配返回 null。 */
export function matchRoute(pathname: string): Route | null {
  return ROUTES.find((route) => route.path === pathname) ?? null;
}
