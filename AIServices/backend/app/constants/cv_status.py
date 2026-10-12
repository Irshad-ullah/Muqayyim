"""
CV processing status — one enum shared by AIServices, CoreServices and the UI.
AIServices owns transitions and pushes them to CoreServices (core_client).
"""

NOT_UPLOADED = "not_uploaded"
UPLOADED = "uploaded"
PROCESSING = "processing"
PARSED = "parsed"
VERIFIED = "verified"
FAILED = "failed"

CV_STATUS_VALUES = (NOT_UPLOADED, UPLOADED, PROCESSING, PARSED, VERIFIED, FAILED)
