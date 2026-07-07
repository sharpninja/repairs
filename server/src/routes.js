import { SubmissionService } from "../gen/repairs/v1/submissions_pb.js";
import { startSession, refreshSession, submitReview, submitRepair, getSubmissionStatus, getAppConfig, logClientError } from "./impl.js";

// Connect/gRPC/gRPC-Web are all served from this one service registration.
export default (router) =>
  router.service(SubmissionService, { startSession, refreshSession, submitReview, submitRepair, getSubmissionStatus, getAppConfig, logClientError });
