import mongoose from 'mongoose';

// Read-only model mapping to the cv_parsed_data collection owned by the AI Service.
// The Core Service only reads from this collection — never writes.
const cvDataSchema = new mongoose.Schema(
  {
    user_id:    { type: String, required: true, index: true },
    file_name:  String,
    file_path:  String,
    upload_date:{ type: Date, default: Date.now },
    parsed_data: {
      skills:     [{ name: String, confidence: Number }],
      education:  [{ degree: String, institution: String, year: String, confidence: Number }],
      experience: [{ title: String, company: String, duration: String, confidence: Number }],
      projects:   [{ name: String, description: String, technologies: [String] }],
    },
    parsing_status: String,
  },
  { collection: 'cv_parsed_data' }
);

const CvData = mongoose.model('CvData', cvDataSchema);
export default CvData;
