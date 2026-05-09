import mongoose from "mongoose";

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
      phone: { type: String, default: "" },
      location: { type: String, default: "" },
      website: { type: String, default: "" },
      linkedin: { type: String, default: "" },
      github: { type: String, default: "" },
    },
    summary: { type: String, default: "" },
    experience: [
      {
        company: { type: String, required: true },
        title: { type: String, required: true },
        location: { type: String, default: "" },
        startDate: { type: String, default: "" },
        endDate: { type: String, default: "" },
        current: { type: Boolean, default: false },
        description: { type: String, default: "" },
        source: { type: String, enum: ["manual", "cv"], default: "manual" },
      },
    ],
    education: [
      {
        institution: { type: String, required: true },
        degree: { type: String, default: "" },
        field: { type: String, default: "" },
        startDate: { type: String, default: "" },
        endDate: { type: String, default: "" },
        gpa: { type: String, default: "" },
        source: { type: String, enum: ["manual", "cv"], default: "manual" },
      },
    ],
    skills: {
      manual: { type: [String], default: [] },
      cv: { type: [String], default: [] },
      extracted: { type: [String], default: [] },
    },
    certifications: [
      {
        name: { type: String, required: true },
        issuer: { type: String, default: "" },
        date: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],
    projects: {
      manual: [
        {
          name: { type: String, required: true },
          description: { type: String, default: "" },
          url: { type: String, default: "" },
          technologies: { type: [String], default: [] },
        },
      ],
      github: [
        {
          repoId: Number,
          name: String,
          description: { type: String, default: "" },
          url: String,
          languages: { type: [String], default: [] },
          topics: { type: [String], default: [] },
          stars: { type: Number, default: 0 },
        },
      ],
      cv: [
        {
          name: { type: String, required: true },
          description: { type: String, default: "" },
          technologies: { type: [String], default: [] },
        },
      ],
      selected: [
        {
          source: {
            type: String,
            enum: ["manual", "github", "cv"],
            default: "manual",
          },
          name: { type: String, required: true },
          description: { type: String, default: "" },
          url: { type: String, default: "" },
          technologies: { type: [String], default: [] },
        },
      ],
    },
    githubData: {
      username: { type: String, default: "" },
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
