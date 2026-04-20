import { UserView } from "../../users/user-view.util";

export interface AuthenticatedRequest {
  headers: {
    authorization?: string;
  };
  user: UserView;
}