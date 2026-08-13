import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inquiriesRouter from "./inquiries";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inquiriesRouter);

export default router;
