import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  getRoot() {
    return {
      service: "rocky-maxx-api",
      status: "ok",
      endpoints: {
        health: "/api/health",
        login: "/api/auth/login",
        me: "/api/auth/me",
        users: "/api/users",
        roles: "/api/roles",
        inventory: "/api/inventory",
      },
    };
  }
}