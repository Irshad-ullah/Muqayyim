# Frontend Documentation
## CV Parsing React Application

## Quick Start

### Installation
```bash
# Install dependencies
npm install

# Create .env file
echo "VITE_API_URL=http://localhost:8000" > .env

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

## Project Structure

```
frontend/src/
├── components/
│   ├── CVUpload.jsx          # File upload with drag-drop
│   ├── ParsedSummary.jsx     # Results display
│   ├── SkillsSection.jsx     # Skills editor
│   ├── EducationSection.jsx  # Education editor
│   └── ExperienceSection.jsx # Experience editor
├── pages/
│   └── CVParsingPage.jsx     # Main page orchestrator
├── services/
│   └── cvService.js          # API client
├── hooks/
│   └── useCVParsing.js       # Custom state hook
├── App.jsx
└── main.jsx
```

## Components

### CVUpload
File upload component with validation

**Props:**
```jsx
{
  onUploadSuccess: (response) => void,
  onUploadError: (error) => void
}
```

**Features:**
- Drag-and-drop interface
- Click to browse
- File type validation (PDF, DOC, DOCX)
- File size validation (5MB max)
- Progress indicator
- Error messages

**Usage:**
```jsx
<CVUpload
  onUploadSuccess={handleSuccess}
  onUploadError={handleError}
/>
```

### ParsedSummary
Results display with loading skeleton

**Props:**
```jsx
{
  parsedData: {
    skills: Array,
    education: Array,
    experience: Array
  },
  isLoading: Boolean,
  onEdit: (action) => void,
  onDelete: (action) => void,
  onSave: () => Promise<void>
}
```

**Features:**
- Displays parsed results
- Loading skeleton animation
- Confidence indicators
- Uncertainty highlighting
- Loading states

### SkillsSection
Editable skills list

**Features:**
- Add new skills
- Edit skill names
- Delete skills
- Confidence badges (High/Medium/Low)
- Duplicate prevention
- Inline editing

### EducationSection
Editable education list

**Features:**
- Add education entries
- Edit degree, institution, year
- Delete entries
- Confidence indicators
- Form validation

### ExperienceSection
Editable experience list

**Features:**
- Add job entries
- Edit title, company, duration
- Delete entries
- Confidence indicators

### CVParsingPage
Main orchestrator component

**Features:**
- Step-based UI (Upload → Parsing → Review → Success)
- Progress indicator
- Error handling
- State management
- Flow control

## Services

### cvService
API client for backend communication

```javascript
import { cvService } from '../services/cvService';

// Upload CV
const response = await cvService.uploadCV(file);

// Parse CV
const parsed = await cvService.parseCV(fileId);

// Verify and save
await cvService.verifyCVData(fileId, verifiedData);

// Get summary
const summary = await cvService.getCVSummary(userId);
```

## Hooks

### useCVParsing
Custom hook for CV parsing state management

```javascript
import useCVParsing from '../hooks/useCVParsing';

const {
  currentStep,      // 'upload' | 'parsing' | 'review' | 'success'
  fileId,           // Uploaded file ID
  parsedData,       // Initial parsed data
  editedData,       // User-edited data
  isLoading,        // Loading state
  error,            // Error message
  uploadAndParse,   // (file) => Promise
  editData,         // (action) => void
  deleteData,       // (action) => void
  saveData,         // () => Promise
  reset             // () => void
} = useCVParsing();
```

## Styling

Built with **Tailwind CSS**

Color scheme:
- Blue: Primary actions
- Purple: Education section
- Green: Experience section
- Yellow: Warnings/Low confidence
- Red: Errors/Delete

## State Management

### Page-level State
```javascript
const [currentStep, setCurrentStep] = useState('upload');
const [fileId, setFileId] = useState(null);
const [parsedData, setParsedData] = useState(null);
const [editedData, setEditedData] = useState(null);
```

### Component-level State
Each section manages its own editing state for better modularity

## API Integration

### Environment Variables
```env
VITE_API_URL=http://localhost:8000
```

### API Calls
All API calls use the `cvService`:

```javascript
// Upload
const response = await fetch(`${API_BASE_URL}/api/cv/upload`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});

// Parse
const response = await fetch(`${API_BASE_URL}/api/cv/parse/${fileId}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});

// Verify
const response = await fetch(`${API_BASE_URL}/api/cv/verify`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ file_id, verified_data })
});
```

## User Flow

1. **Upload**: User selects/drags CV file
2. **Validation**: Client validates format and size
3. **Upload**: File sent to server with progress
4. **Parsing**: Backend parses CV (10-30 seconds)
5. **Display**: Results shown with confidence indicators
6. **Review**: User edits and verifies data
7. **Save**: Verified data saved to profile
8. **Success**: Confirmation message

## Error Handling

Global error handling:
- Network errors
- File validation errors
- Parsing failures
- Save failures

All errors show toast notifications and clear error messages.

## Performance

### Optimizations
- Lazy loading of components
- Memoization where appropriate
- Efficient re-renders
- Debounced searches (if added)

### Bundle Size
- React: ~42KB
- Tailwind: ~20KB
- Total gzipped: ~50KB

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Development

### Code Style
- ESLint configuration included
- Prettier formatting
- Component organization by feature

### Testing
```bash
npm run test
npm run test:watch
```

### Building
```bash
# Development
npm run dev

# Production build
npm run build

# Preview build
npm run preview
```

## Dependencies

### Production
- **react**: UI framework
- **react-router-dom**: Navigation
- **axios**: HTTP client
- **lucide-react**: Icons
- **tailwindcss**: Styling
- **react-hot-toast**: Notifications

### Development
- **vite**: Build tool
- **eslint**: Linting
- **prettier**: Formatting
- **tailwindcss**: CSS utility framework

## Accessibility

✅ Keyboard navigation support
✅ ARIA labels on interactive elements
✅ Color contrast compliance
✅ Screen reader friendly
✅ Focus indicators

## Mobile Responsiveness

- Desktop: Full UI
- Tablet: Optimized layout
- Mobile: Touch-friendly interface
  - Larger buttons
  - Stacked sections
  - Full-width forms

## Troubleshooting

### API Connection Failed
1. Verify backend is running: `http://localhost:8000/health`
2. Check `VITE_API_URL` in `.env`
3. Check browser console for CORS errors

### File Upload Not Working
1. Check file format (PDF, DOC, DOCX)
2. Check file size (< 5MB)
3. Check browser console for errors

### Parsing Never Completes
1. Check backend logs for processing errors
2. Try with a simpler CV
3. Check network tab in DevTools

### Data Not Saving
1. Check user authentication
2. Verify MongoDB is running
3. Check backend logs

## Best Practices

1. **State Management**: Keep it simple with React hooks
2. **Component Reusability**: Extract common patterns
3. **Error Handling**: Always handle errors gracefully
4. **Loading States**: Show feedback for async operations
5. **Validation**: Validate on client and server
6. **Security**: Store tokens securely (not localStorage)
7. **Performance**: Use React.memo for expensive components

## Deployment

### Vercel
```bash
npm i -g vercel
vercel
```

### Netlify
```bash
npm i -g netlify-cli
netlify deploy --prod
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "preview"]
```

## Security Notes

⚠️ **Never store sensitive tokens in localStorage**
- Use secure, httpOnly cookies instead
- Implement proper OAuth/JWT flow
- Validate all inputs on server

## Future Enhancements

- [ ] Resume templates
- [ ] Skill suggestions
- [ ] LinkedIn integration
- [ ] Multi-language support
- [ ] Offline mode
- [ ] Advanced filtering
- [ ] Export to PDF

## Support

For issues:
1. Check browser console
2. Check backend logs
3. Review API responses
4. Test with sample files

---

**Version**: 1.0.0
**Last Updated**: January 2024
