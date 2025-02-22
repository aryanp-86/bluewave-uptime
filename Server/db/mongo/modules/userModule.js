import UserModel from "../../models/User.js";
import TeamModel from "../../models/Team.js";
import { errorMessages } from "../../../utils/messages.js";
import { GenerateAvatarImage } from "../../../utils/imageProcessing.js";

const DUPLICATE_KEY_CODE = 11000; // MongoDB error code for duplicate key
import { ParseBoolean } from "../../../utils/utils.js";
const SERVICE_NAME = "userModule";

/**
 * Insert a User
 * @async
 * @param {Express.Request} req
 * @param {Express.Response} res
 * @returns {Promise<UserModel>}
 * @throws {Error}
 */
const insertUser = async (userData, imageFile) => {
	try {
		if (imageFile) {
			// 1.  Save the full size image
			userData.profileImage = {
				data: imageFile.buffer,
				contentType: imageFile.mimetype,
			};

			// 2.  Get the avatar sized image
			const avatar = await GenerateAvatarImage(imageFile);
			userData.avatarImage = avatar;
		}

		//  Handle creating team if superadmin
		if (userData.role.includes("superadmin")) {
			const team = new TeamModel({
				email: userData.email,
			});
			userData.teamId = team._id;
			userData.checkTTL = 60 * 60 * 24 * 30;
			await team.save();
		}

		const newUser = new UserModel(userData);
		await newUser.save();
		return await UserModel.findOne({ _id: newUser._id })
			.select("-password")
			.select("-profileImage"); // .select() doesn't work with create, need to save then find
	} catch (error) {
		if (error.code === DUPLICATE_KEY_CODE) {
			error.message = errorMessages.DB_USER_EXISTS;
		}
		error.service = SERVICE_NAME;
		error.method = "insertUser";
		throw error;
	}
};

/**
 * Get User by Email
 * Gets a user by Email.  Not sure if we'll ever need this except for login.
 * If not needed except for login, we can move password comparison here
 * Throws error if user not found
 * @async
 * @param {Express.Request} req
 * @param {Express.Response} res
 * @returns {Promise<UserModel>}
 * @throws {Error}
 */
const getUserByEmail = async (email) => {
	try {
		// Need the password to be able to compare, removed .select()
		// We can strip the hash before returning the user
		const user = await UserModel.findOne({ email: email }).select("-profileImage");
		if (!user) {
			throw new Error(errorMessages.DB_USER_NOT_FOUND);
		}
		return user;
	} catch (error) {
		error.service = SERVICE_NAME;
		error.method = "getUserByEmail";
		throw error;
	}
};

/**
 * Update a user by ID
 * @async
 * @param {Express.Request} req
 * @param {Express.Response} res
 * @returns {Promise<UserModel>}
 * @throws {Error}
 */

const updateUser = async (req, res) => {
	const candidateUserId = req.params.userId;
	try {
		const candidateUser = { ...req.body };
		// ******************************************
		// Handle profile image
		// ******************************************

		if (ParseBoolean(candidateUser.deleteProfileImage) === true) {
			candidateUser.profileImage = null;
			candidateUser.avatarImage = null;
		} else if (req.file) {
			// 1.  Save the full size image
			candidateUser.profileImage = {
				data: req.file.buffer,
				contentType: req.file.mimetype,
			};

			// 2.  Get the avaatar sized image
			const avatar = await GenerateAvatarImage(req.file);
			candidateUser.avatarImage = avatar;
		}

		// ******************************************
		// End handling profile image
		// ******************************************

		const updatedUser = await UserModel.findByIdAndUpdate(
			candidateUserId,
			candidateUser,
			{ new: true } // Returns updated user instead of pre-update user
		)
			.select("-password")
			.select("-profileImage");
		return updatedUser;
	} catch (error) {
		error.service = SERVICE_NAME;
		error.method = "updateUser";
		throw error;
	}
};

/**
 * Delete a user by ID
 * @async
 * @param {Express.Request} req
 * @param {Express.Response} res
 * @returns {Promise<UserModel>}
 * @throws {Error}
 */
const deleteUser = async (userId) => {
	try {
		const deletedUser = await UserModel.findByIdAndDelete(userId);
		if (!deletedUser) {
			throw new Error(errorMessages.DB_USER_NOT_FOUND);
		}
		return deletedUser;
	} catch (error) {
		error.service = SERVICE_NAME;
		error.method = "deleteUser";
		throw error;
	}
};

/**
 * Delete a user by ID
 * @async
 * @param {string} teamId
 * @returns {void}
 * @throws {Error}
 */
const deleteTeam = async (teamId) => {
	try {
		await TeamModel.findByIdAndDelete(teamId);
	} catch (error) {
		error.service = SERVICE_NAME;
		error.method = "deleteTeam";
		throw error;
	}
};

const deleteAllOtherUsers = async () => {
	try {
		await UserModel.deleteMany({ role: { $ne: "superadmin" } });
	} catch (error) {
		error.service = SERVICE_NAME;
		error.method = "deleteAllOtherUsers";
		throw error;
	}
};

const getAllUsers = async (req, res) => {
	try {
		const users = await UserModel.find().select("-password").select("-profileImage");
		return users;
	} catch (error) {
		error.service = SERVICE_NAME;
		error.method = "getAllUsers";
		throw error;
	}
};

const logoutUser = async (userId) => {
	try {
		await UserModel.updateOne({ _id: userId }, { $unset: { authToken: null } });
		return true;
	} catch (error) {
		error.service = SERVICE_NAME;
		error.method = "logoutUser";
		throw error;
	}
};

export {
	insertUser,
	getUserByEmail,
	updateUser,
	deleteUser,
	deleteTeam,
	deleteAllOtherUsers,
	getAllUsers,
	logoutUser,
};
