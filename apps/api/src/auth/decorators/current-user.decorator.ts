import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import { AuthenticatedRequest } from "../interfaces/authenticated-request.interface";

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user;
});