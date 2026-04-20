import { SetMetadata } from "@nestjs/common";

export const REQUIRED_GROUPS_KEY = "required-groups";
export const RequireGroups = (...groups: string[]) => SetMetadata(REQUIRED_GROUPS_KEY, groups);