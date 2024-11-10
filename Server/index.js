import path from "path";
import fs from "fs";
import swaggerUi from "swagger-ui-express";

import express from "express";
import helmet from "helmet";
import cors from "cors";
import logger from "./utils/logger.js";
import { verifyJWT } from "./middleware/verifyJWT.js";
import { handleErrors } from "./middleware/handleErrors.js";
import { errorMessages } from "./utils/messages.js";
import authRouter from "./routes/authRoute.js";
import inviteRouter from "./routes/inviteRoute.js";
import monitorRouter from "./routes/monitorRoute.js";
import checkRouter from "./routes/checkRoute.js";
import maintenanceWindowRouter from "./routes/maintenanceWindowRoute.js";
import settingsRouter from "./routes/settingsRoute.js";
import { fileURLToPath } from "url";

import queueRouter from "./routes/queueRoute.js";

//JobQueue service and dependencies
import JobQueue from "./service/jobQueue.js";
import { Queue, Worker } from "bullmq";

//Network service and dependencies
import NetworkService from "./service/networkService.js";
import axios from "axios";
import ping from "ping";
import http from "http";

// Email service and dependencies
import EmailService from "./service/emailService.js";
import nodemailer from "nodemailer";
import pkg from "handlebars";
const { compile } = pkg;
import mjml2html from "mjml";

// Settings Service and dependencies
import SettingsService from "./service/settingsService.js";
import AppSettings from "./db/models/AppSettings.js";

import StatusService from "./service/statusService.js";
import NotificationService from "./service/notificationService.js";

import db from "./db/mongo/MongoDB.js";
import NtfyService from "./service/ntfyService.js";
const SERVICE_NAME = "Server";

let cleaningUp = false;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openApiSpec = JSON.parse(
	fs.readFileSync(path.join(__dirname, "openapi.json"), "utf8")
);

const PORT = 5000;

// Need to wrap server setup in a function to handle async nature of JobQueue
const startApp = async () => {
	const app = express();

	// middlewares
	app.use(
		cors()
		//We will add configuration later
	);
	app.use(express.json());
	app.use(helmet());

	// Add db, jobQueue, emailService, and settingsService to request object for easy access
	app.use((req, res, next) => {
		req.db = db;
		req.jobQueue = jobQueue;
		req.emailService = emailService;
		req.settingsService = settingsService;
		next();
	});

	// Swagger UI
	app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

	//routes
	app.use("/api/v1/auth", authRouter);
	app.use("/api/v1/settings", verifyJWT, settingsRouter);
	app.use("/api/v1/invite", inviteRouter);
	app.use("/api/v1/monitors", verifyJWT, monitorRouter);
	app.use("/api/v1/checks", verifyJWT, checkRouter);
	app.use("/api/v1/maintenance-window", verifyJWT, maintenanceWindowRouter);
	app.use("/api/v1/queue", verifyJWT, queueRouter);

	//health check
	app.use("/api/v1/healthy", (req, res) => {
		try {
			logger.info({ message: "Checking Health of the server." });
			return res.status(200).json({ message: "Healthy" });
		} catch (error) {
			logger.error({
				message: error.message,
				service: SERVICE_NAME,
				method: "healthCheck",
				stack: error.stack,
			});
			return res.status(500).json({ message: error.message });
		}
	});

	/**
	 * Error handler middleware
	 * Should be called last
	 */
	app.use(handleErrors);

	// Create services
	await db.connect();
	app.listen(PORT, () => {
		logger.info({ message: `server started on port:${PORT}` });
	});
	const settingsService = new SettingsService(AppSettings);

	await settingsService.loadSettings();
	const emailService = new EmailService(
		settingsService,
		fs,
		path,
		compile,
		mjml2html,
		nodemailer,
		logger
	);
	const ntfyService = new NtfyService(logger);
	const networkService = new NetworkService(axios, ping, logger, http);
	const statusService = new StatusService(db, logger);
	const notificationService = new NotificationService(emailService, db, logger, ntfyService);
	const jobQueue = await JobQueue.createJobQueue(
		db,
		networkService,
		statusService,
		notificationService,
		settingsService,
		logger,
		Queue,
		Worker
	);

	const cleanup = async () => {
		if (cleaningUp) {
			logger.warn({ message: "Already cleaning up" });
			return;
		}
		cleaningUp = true;
		try {
			logger.info({ message: "shutting down gracefully" });
			await jobQueue.obliterate();
			await db.disconnect();
			logger.info({ message: "shut down gracefully" });
		} catch (error) {
			logger.error({
				message: error.message,
				service: SERVICE_NAME,
				method: "cleanup",
				stack: error.stack,
			});
		}
		process.exit(0);
	};
	process.on("SIGUSR2", cleanup);
	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);
};

startApp().catch((error) => {
	logger.error({
		message: error.message,
		service: SERVICE_NAME,
		method: "startApp",
		stack: error.stack,
	});
	process.exit(1);
});
