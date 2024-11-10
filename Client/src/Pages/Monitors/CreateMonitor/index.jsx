import { useState, useEffect } from "react";
import { Box, Button, ButtonGroup, Stack, Typography } from "@mui/material";
import LoadingButton from '@mui/lab/LoadingButton';
import { useSelector, useDispatch } from "react-redux";
import { monitorValidation } from "../../../Validation/validation";
import { createUptimeMonitor } from "../../../Features/UptimeMonitors/uptimeMonitorsSlice";
import { checkEndpointResolution } from "../../../Features/UptimeMonitors/uptimeMonitorsSlice"
import { useNavigate, useParams } from "react-router-dom";
import { useTheme } from "@emotion/react";
import { createToast } from "../../../Utils/toastUtils";
import { logger } from "../../../Utils/Logger";
import { ConfigBox } from "../styled";
import Radio from "../../../Components/Inputs/Radio";
import Field from "../../../Components/Inputs/Field";
import Select from "../../../Components/Inputs/Select";
import Checkbox from "../../../Components/Inputs/Checkbox";
import Breadcrumbs from "../../../Components/Breadcrumbs";
import { getUptimeMonitorById } from "../../../Features/UptimeMonitors/uptimeMonitorsSlice";
import "./index.css";
import axios from "axios";

const CreateMonitor = () => {
	const MS_PER_MINUTE = 60000;
	const { user, authToken } = useSelector((state) => state.auth);
	const { monitors, isLoading } = useSelector((state) => state.uptimeMonitors);
	const [ntfyLoading, setntfyLoading] = useState(false)
	const [showNtfySettings, setShowNtfySettings] = useState(false)
	const dispatch = useDispatch();
	const navigate = useNavigate();
	const theme = useTheme();
	// Ntfy settings
	const [ntfySettings, setNtfySettings] = useState({
		friendlyName: "",
		topic: "",
		serverUrl: "https://ntfy.sh", // Default value
		priority: "5",
		authMode: "no-auth", // Default authentication mode
		username: "",
		password: "",
		accessToken: "",
	});

	const idMap = {
		"monitor-url": "url",
		"monitor-name": "name",
		"monitor-checks-http": "type",
		"monitor-checks-ping": "type",
		"notify-email-default": "notification-email",
	};

	const { monitorId } = useParams();
	const [monitor, setMonitor] = useState({
		url: "",
		name: "",
		type: "http",
		notifications: [],
		interval: 1,
	});

	// Auth options for ntfy
	const authOptions = [
		{ _id: 'no-auth', name: 'No auth' },
		{ _id: 'user-pass', name: 'Username and Password' },
		{ _id: 'accessToken', name: 'Access Token' }
	];

	const [https, setHttps] = useState(true);
	const [errors, setErrors] = useState({});

	useEffect(() => {
		const fetchMonitor = async () => {
			if (monitorId) {
				const action = await dispatch(getUptimeMonitorById({ authToken, monitorId }));

				if (action.payload.success) {
					const data = action.payload.data;
					const { name, ...rest } = data; //data.name is read-only
					if (rest.type === "http") {
						const url = new URL(rest.url);
						rest.url = url.host;
					}
					rest.name = `${name} (Clone)`;
					rest.interval /= MS_PER_MINUTE;
					setMonitor({
						...rest,
					});
				} else {
					navigate("/not-found", { replace: true });
					createToast({
						body: "There was an error cloning the monitor.",
					});
				}
			}
		};
		fetchMonitor();
	}, [monitorId, authToken, monitors]);

	//Handles changes for ntfy settings
	const handleChangeNtfy = (field, value) => {
		setNtfySettings(prev => ({
			...prev,
			[field]: value
		}));
	};

	const handleChange = (event, name) => {
		const { value, id } = event.target;
		if (!name) name = idMap[id];

		if (name.includes("notification-")) {
			name = name.replace("notification-", "");
			let hasNotif = monitor.notifications.some(
				(notification) => notification.type === name
			);
			setMonitor((prev) => {
				const notifs = [...prev.notifications];
				if (hasNotif) {
					return {
						...prev,
						notifications: notifs.filter((notif) => notif.type !== name),
					};
				} else {
					return {
						...prev,
						notifications: [
							...notifs,
							name === "email"
								? { type: name, address: value }
								: // TODO - phone number
								{ type: name, phone: value },
						],
					};
				}
			});
		} else {
			setMonitor((prev) => ({
				...prev,
				[name]: value,
			}));

			const { error } = monitorValidation.validate(
				{ [name]: value },
				{ abortEarly: false }
			);
			console.log(error);
			setErrors((prev) => {
				const updatedErrors = { ...prev };
				if (error) updatedErrors[name] = error.details[0].message;
				else delete updatedErrors[name];
				return updatedErrors;
			});
		}
	};

	// Handler for adding Ntfy notification to monitor
	const handleChangeForNtfy = () => {
		setntfyLoading(true);
		setMonitor((prev) => {
			const notifs = [...prev.notifications];

			return {
				...prev,
				notifications: [
					...notifs,
					{ type: "ntfy", ntfyConfig: ntfySettings }
				],
			};
		});
		createToast({ body: "Ntfy notification added successfully" });
		setntfyLoading(false);
	}

	// Handler for Testing Ntfy notification
	const testNotification = async () => {
		try {
			// Set up authorization headers based on authMode
			let headers = {
				Title: ntfySettings.friendlyName || `Monitor Alert`,
				Priority: ntfySettings.priority,
				Tags: "warning",
				"Content-Type": "text/plain",
			};

			if (
				ntfySettings.authMode === "user-pass" &&
				ntfySettings.username &&
				ntfySettings.password
			) {
				headers.Authorization =
					"Basic " +
					Buffer.from(`${ntfySettings.username}:${ntfySettings.password}`).toString(
						"base64"
					);
			} else if (ntfySettings.authMode === "accessToken" && ntfySettings.accessToken) {
				headers.Authorization = "Bearer " + ntfySettings.accessToken;
			}

			// Ensure the server URL does not have a trailing slash
			const serverUrl = ntfySettings.serverUrl.endsWith("/")
				? ntfySettings.serverUrl.slice(0, -1)
				: ntfySettings.serverUrl;

			// Plain text body message
			const ntfyBody = "This is a test message from your Ntfy setup.";

			// Send the Ntfy notification
			const response = await axios.post(`${serverUrl}/${ntfySettings.topic}`, ntfyBody, {
				headers,
			});

			if (response.status === 200) {
				createToast({
					body: "Notification sent successfully",
				});
			}
		} catch (error) {
			createToast({
				body: `Failed to send notification with ${error}`,
			});
		}
	};


	const handleCreateMonitor = async (event) => {
		event.preventDefault();
		//obj to submit
		let form = {
			url:
				//preprending protocol for url
				monitor.type === "http"
					? `http${https ? "s" : ""}://` + monitor.url
					: monitor.url,
			name: monitor.name === "" ? monitor.url : monitor.name,
			type: monitor.type,
			interval: monitor.interval * MS_PER_MINUTE,
		};

		const { error } = monitorValidation.validate(form, {
			abortEarly: false,
		});

		if (error) {
			const newErrors = {};
			error.details.forEach((err) => {
				newErrors[err.path[0]] = err.message;
			});
			setErrors(newErrors);
			createToast({ body: "Error validation data." });
		} else {
			if (monitor.type === "http") {
				const checkEndpointAction = await dispatch(
					checkEndpointResolution({ authToken, monitorURL: form.url })
				)
				if (checkEndpointAction.meta.requestStatus === "rejected") {
					createToast({ body: "The endpoint you entered doesn't resolve. Check the URL again." });
					setErrors({ url: "The entered URL is not reachable." });
					return;
				}
			}

			form = {
				...form,
				description: form.name,
				teamId: user.teamId,
				userId: user._id,
				notifications: monitor.notifications,
			};
			const action = await dispatch(createUptimeMonitor({ authToken, monitor: form }));
			if (action.meta.requestStatus === "fulfilled") {
				createToast({ body: "Monitor created successfully!" });
				navigate("/monitors");
			} else {
				createToast({ body: "Failed to create monitor." });
			}
		}
	};

	//select values
	const frequencies = [
		{ _id: 1, name: "1 minute" },
		{ _id: 2, name: "2 minutes" },
		{ _id: 3, name: "3 minutes" },
		{ _id: 4, name: "4 minutes" },
		{ _id: 5, name: "5 minutes" },
	];

	return (
		<Box className="create-monitor">
			<Breadcrumbs
				list={[
					{ name: "monitors", path: "/monitors" },
					{ name: "create", path: `/monitors/create` },
				]}
			/>
			<Stack
				component="form"
				className="create-monitor-form"
				onSubmit={handleCreateMonitor}
				noValidate
				spellCheck="false"
				gap={theme.spacing(12)}
				mt={theme.spacing(6)}
			>
				<Typography
					component="h1"
					variant="h1"
				>
					<Typography
						component="span"
						fontSize="inherit"
					>
						Create your{" "}
					</Typography>
					<Typography
						component="span"
						variant="h2"
						fontSize="inherit"
						fontWeight="inherit"
					>
						monitor
					</Typography>
				</Typography>
				<ConfigBox>
					<Box>
						<Typography component="h2">General settings</Typography>
						<Typography component="p">
							Here you can select the URL of the host, together with the type of monitor.
						</Typography>
					</Box>
					<Stack gap={theme.spacing(15)}>
						<Field
							type={monitor.type === "http" ? "url" : "text"}
							id="monitor-url"
							label="URL to monitor"
							https={https}
							placeholder="google.com"
							value={monitor.url}
							onChange={handleChange}
							error={errors["url"]}
						/>
						<Field
							type="text"
							id="monitor-name"
							label="Display name"
							isOptional={true}
							placeholder="Google"
							value={monitor.name}
							onChange={handleChange}
							error={errors["name"]}
						/>
					</Stack>
				</ConfigBox>
				<ConfigBox>
					<Box>
						<Typography component="h2">Checks to perform</Typography>
						<Typography component="p">
							You can always add or remove checks after adding your site.
						</Typography>
					</Box>
					<Stack gap={theme.spacing(12)}>
						<Stack gap={theme.spacing(6)}>
							<Radio
								id="monitor-checks-http"
								title="Website monitoring"
								desc="Use HTTP(s) to monitor your website or API endpoint."
								size="small"
								value="http"
								checked={monitor.type === "http"}
								onChange={(event) => handleChange(event)}
							/>
							{monitor.type === "http" ? (
								<ButtonGroup sx={{ ml: theme.spacing(16) }}>
									<Button
										variant="group"
										filled={https.toString()}
										onClick={() => setHttps(true)}
									>
										HTTPS
									</Button>
									<Button
										variant="group"
										filled={(!https).toString()}
										onClick={() => setHttps(false)}
									>
										HTTP
									</Button>
								</ButtonGroup>
							) : (
								""
							)}
						</Stack>
						<Radio
							id="monitor-checks-ping"
							title="Ping monitoring"
							desc="Check whether your server is available or not."
							size="small"
							value="ping"
							checked={monitor.type === "ping"}
							onChange={(event) => handleChange(event)}
						/>
						{errors["type"] ? (
							<Box className="error-container">
								<Typography
									component="p"
									className="input-error"
									color={theme.palette.error.text}
								>
									{errors["type"]}
								</Typography>
							</Box>
						) : (
							""
						)}
					</Stack>
				</ConfigBox>
				<ConfigBox>
					<Box>
						<Typography component="h2">Incident notifications</Typography>
						<Typography component="p">
							When there is an incident, notify users.
						</Typography>
					</Box>
					<Stack gap={theme.spacing(6)}>
						<Typography component="p">When there is a new incident,</Typography>
						<Checkbox
							id="notify-sms"
							label="Notify via SMS (coming soon)"
							isChecked={false}
							value=""
							onChange={() => logger.warn("disabled")}
							isDisabled={true}
						/>
						<Checkbox
							id="notify-email-default"
							label={`Notify via email (to ${user.email})`}
							isChecked={monitor.notifications.some(
								(notification) => notification.type === "email"
							)}
							value={user?.email}
							onChange={(event) => handleChange(event)}
						/>
						<Checkbox
							id="notify-via-ntfy"
							label="Notify via ntfy.sh"
							isChecked={showNtfySettings}
							onChange={() => setShowNtfySettings(prev => !prev)}
							value=""
						/>
						{/* Ntfy-specific fields: Render when ntfy is selected */}
						{showNtfySettings === true && (
							<Box sx={{ mt: 2 }}>
								<Stack spacing={3}>
									<Field
										id="ntfy-friendly-name"
										type="text"
										label="Friendly name"
										placeholder="Enter a friendly name"
										value={ntfySettings.friendlyName}
										onChange={(e) => handleChangeNtfy('friendlyName', e.target.value)}
									/>
									<Field
										id="ntfy-topic"
										type="text"
										label="Topic"
										placeholder="Enter ntfy topic"
										value={ntfySettings.topic}
										onChange={(e) => handleChangeNtfy('topic', e.target.value)}
									/>
									<Field
										id="ntfy-server-url"
										type="text"
										label="Server URL"
										placeholder="https://ntfy.sh"
										value={ntfySettings.serverUrl}
										onChange={(e) => handleChangeNtfy('serverUrl', e.target.value)}
									/>
									<Field
										id="ntfy-priority"
										type="number"
										label="Priority"
										min="1"
										max="5"
										placeholder="1-5"
										value={ntfySettings.priority}
										onChange={(e) => handleChangeNtfy('priority', e.target.value)}
									/>
									<Select
										id="auth-select"
										label="Authentication Method"
										value={ntfySettings.authMode}
										onChange={(e) => handleChangeNtfy('authMode', e.target.value)}
										items={authOptions}
									/>
									{ntfySettings.authMode === "user-pass" && (
										<>
											<Field
												id="ntfy-username"
												type="text"
												label="Username"
												placeholder="Enter username"
												value={ntfySettings.username}
												onChange={(e) => handleChangeNtfy('username', e.target.value)}
											/>
											<Field
												id="ntfy-password"
												type="password"
												label="Password"
												placeholder="Enter password"
												value={ntfySettings.password}
												onChange={(e) => handleChangeNtfy('password', e.target.value)}
											/>
										</>
									)}
									{ntfySettings.authMode === "accessToken" && (
										<Field
											id="ntfy-access-token"
											type="text"
											label="Access Token"
											placeholder="Enter access token"
											value={ntfySettings.accessToken}
											onChange={(e) => handleChangeNtfy('accessToken', e.target.value)}
										/>
									)}
									<Stack
										direction="row"
										spacing={2}
									>
										<LoadingButton
											variant="contained"
											color="primary"
											onClick={testNotification}
											disabled={Object.keys(errors).length !== 0}
											loading={ntfyLoading}
										>
											Test
										</LoadingButton>
										<LoadingButton
											variant="contained"
											color="primary"
											onClick={handleChangeForNtfy}
											disabled={Object.keys(errors).length !== 0}
											loading={isLoading}
										>
											Save
										</LoadingButton>
									</Stack>
								</Stack>
							</Box>
						)}
						<Checkbox
							id="notify-email"
							label="Also notify via email to multiple addresses (coming soon)"
							isChecked={false}
							value=""
							onChange={() => logger.warn("disabled")}
							isDisabled={true}
						/>
						{monitor.notifications.some(
							(notification) => notification.type === "emails"
						) ? (
							<Box mx={theme.spacing(16)}>
								<Field
									id="notify-email-list"
									type="text"
									placeholder="name@gmail.com"
									value=""
									onChange={() => logger.warn("disabled")}
								/>
								<Typography mt={theme.spacing(4)}>
									You can separate multiple emails with a comma
								</Typography>
							</Box>
						) : (
							""
						)}
					</Stack>
				</ConfigBox>
				<ConfigBox>
					<Box>
						<Typography component="h2">Advanced settings</Typography>
					</Box>
					<Stack gap={theme.spacing(12)}>
						<Select
							id="monitor-interval"
							label="Check frequency"
							value={monitor.interval || 1}
							onChange={(event) => handleChange(event, "interval")}
							items={frequencies}
						/>
					</Stack>
				</ConfigBox>
				<Stack
					direction="row"
					justifyContent="flex-end"
				>
					<LoadingButton
						variant="contained"
						color="primary"
						onClick={handleCreateMonitor}
						disabled={Object.keys(errors).length !== 0 && true}
						loading={isLoading}
					>
						Create monitor
					</LoadingButton>
				</Stack>
			</Stack>
		</Box>
	);
};

export default CreateMonitor;