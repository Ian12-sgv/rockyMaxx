import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get("health")
  health() {
    return { status: "ok", service: "bodega-api" };
  }

  // Alias en la forma que espera el probeServer() del Cliente de escritorio
  // (apps/desktop/main.js) cuando se conecta directo a bodega-api, sin pasar
  // por ninguna tienda -- el cliente siempre sondea "<url>/api/health".
  @Get("api/health")
  apiHealth() {
    return { status: "ok", service: "bodega-api" };
  }
}
