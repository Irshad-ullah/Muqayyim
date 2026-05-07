#!/usr/bin/env python
"""
Check MongoDB CV Data
Quick script to view all stored CV records
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime

async def check_database():
    try:
        # Connect to MongoDB
        client = AsyncIOMotorClient('mongodb://localhost:27017')
        db = client['muqayyim']
        cv_collection = db['cv_parsed_data']
        
        # Get stats
        count = await cv_collection.count_documents({})
        print("\n" + "="*60)
        print("📊 CV PARSING DATABASE - MUQAYYIM")
        print("="*60)
        print(f"Total CVs stored: {count}\n")
        
        if count == 0:
            print("No CVs found in database yet.")
            print("Upload and parse a CV through the web app to populate data.\n")
            return
        
        # Get all CVs sorted by upload date (newest first)
        cursor = cv_collection.find().sort("upload_date", -1)
        i = 1
        async for cv in cursor:
            print(f"CV #{i}")
            print("-" * 60)
            print(f"User ID:        {cv.get('user_id', 'N/A')}")
            print(f"File Name:      {cv.get('file_name', 'N/A')}")
            print(f"Upload Date:    {cv.get('upload_date', 'N/A')}")
            print(f"Status:         {cv.get('parsing_status', 'N/A')}")
            
            parsed = cv.get('parsed_data', {})
            print(f"\n📋 Parsed Data:")
            print(f"  Skills:       {len(parsed.get('skills', []))} found")
            for skill in parsed.get('skills', [])[:3]:
                print(f"    • {skill.get('name')} ({skill.get('confidence', 0)*100:.0f}% confidence)")
            if len(parsed.get('skills', [])) > 3:
                print(f"    ... and {len(parsed.get('skills', [])) - 3} more")
            
            print(f"  Education:    {len(parsed.get('education', []))} found")
            for edu in parsed.get('education', []):
                print(f"    • {edu.get('degree')} from {edu.get('institution')}")
            
            print(f"  Experience:   {len(parsed.get('experience', []))} found")
            for exp in parsed.get('experience', []):
                print(f"    • {exp.get('title')} at {exp.get('company')}")
            
            verified = cv.get('verified_data')
            if verified:
                print(f"\n✅ Verified Data: Available")
                v_skills = len(verified.get('skills', []))
                v_edu = len(verified.get('education', []))
                v_exp = len(verified.get('experience', []))
                print(f"   Skills: {v_skills}, Education: {v_edu}, Experience: {v_exp}")
            else:
                print(f"\n⚠️  Verified Data: Not yet saved")
            
            print()
            i += 1
        
        print("="*60)
        print(f"✅ Database check complete!")
        print("="*60 + "\n")
        
    except Exception as e:
        print(f"\n❌ Error connecting to MongoDB: {e}")
        print("Make sure MongoDB is running:")
        print("  docker start mongo")
        print("  # or")
        print("  docker run -d -p 27017:27017 --name mongo mongo:latest\n")

if __name__ == "__main__":
    asyncio.run(check_database())
