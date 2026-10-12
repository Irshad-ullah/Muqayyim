import mongoose from "mongoose";
import { LIMITS } from "../validation/profileLimits.js";

// Second line of defence: request schemas (validation/profileSchemas.js) run
// first; these constraints apply on write (runValidators) and never on read,
// so older documents that break a newer rule still load.
const str = (max) => ({ type: String, default: "", maxlength: max });
const req = (max) => ({ type: String, required: true, maxlength: max });
const stringList = () => ({ type: [{ type: String, maxlength: LIMITS.skill.max }], default: [] });

const profileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    personalInfo: {
      phone: str(LIMITS.phone.max),
      location: str(LIMITS.locationMax),
      website: str(LIMITS.urlMax),
      linkedin: str(LIMITS.urlMax),
      github: str(LIMITS.urlMax),
    },
    summary: str(LIMITS.summaryMax),
    experience: [
      {
        company: req(LIMITS.orgMax),
        title: req(LIMITS.titleMax),
        location: str(LIMITS.locationMax),
        startDate: str(7),
        endDate: str(7),
        current: { type: Boolean, default: false },
        description: str(LIMITS.descriptionMax),
        source: { type: String, enum: ["manual", "cv"], default: "manual" },
      },
    ],
    education: [
      {
        institution: req(LIMITS.orgMax),
        degree: req(LIMITS.titleMax),
        field: str(LIMITS.titleMax),
        startDate: str(7),
        endDate: str(7),
        gpa: str(LIMITS.gpaMax),
        source: { type: String, enum: ["manual", "cv"], default: "manual" },
      },
    ],
    skills: {
      manual: stringList(),
      cv: stringList(),
      extracted: stringList(),
    },
    certifications: [
      {
        name: req(LIMITS.titleMax),
        issuer: req(LIMITS.orgMax),
        date: str(7),
        url: str(LIMITS.urlMax),
      },
    ],
    projects: {
      manual: [
        {
          name: req(LIMITS.titleMax),
          description: str(LIMITS.descriptionMax),
          url: str(LIMITS.urlMax),
          technologies: stringList(),
        },
      ],
      github: [
        {
          repoId: Number,
          name: String,
          description: str(LIMITS.descriptionMax),
          url: String,
          languages: { type: [String], default: [] },
          topics: { type: [String], default: [] },
          stars: { type: Number, default: 0 },
        },
      ],
      cv: [
        {
          name: req(LIMITS.titleMax),
          description: str(LIMITS.descriptionMax),
          url: str(LIMITS.urlMax),
          technologies: stringList(),
        },
      ],
      selected: [
        {
          source: {
            type: String,
            enum: ["manual", "github", "cv"],
            default: "manual",
          },
          name: req(LIMITS.titleMax),
          description: str(LIMITS.descriptionMax),
          url: str(LIMITS.urlMax),
          technologies: stringList(),
        },
      ],
    },
    githubData: {
      username: str(LIMITS.githubUsername.max),
      repos: { type: mongoose.Schema.Types.Mixed, default: [] },
      extractedSkills: { type: [String], default: [] },
      lastSynced: Date,
    },
    cvData: {
      fileName: { type: String, default: "" },
      uploadDate: Date,
      parsingStatus: { type: String, default: "" },
      parsedData: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    cvImportedAt: Date,
  },
  { timestamps: true },
);

const Profile = mongoose.model("Profile", profileSchema);
export default Profile;
