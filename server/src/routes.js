import { SubmissionService } from "../gen/repairs/v1/submissions_pb.js";
import { submitReview, submitRepair } from "./impl.js";

// Connect/gRPC/gRPC-Web are all served from this one service registration.
export default (router) =>
  router.service(SubmissionService, { submitReview, submitRepair });
