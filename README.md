
TeachOS project requirement 
 
📚 Teacher & Course Management Portal — "TeachOS"


 Problem Statement
In today's digital era, many qualified teachers struggle to reach students beyond their local communities, while students often face difficulties finding trusted courses, coaching centers, and skilled instructors in one organized platform. Existing solutions are often fragmented, expensive, or lack transparency.
Some common challenges include:
Teachers have limited opportunities to promote their courses online.
Students must search across multiple platforms to compare courses and instructors.
There is no centralized platform for both online and offline learning opportunities.
Many coaching centers rely on agents or third parties, increasing costs for students.
Students often lack clear information about course duration, fees, locations, and teachers before enrolling.
Managing course listings and student enrollments manually is time-consuming and inefficient.


🎓 Project Theme
TeachOS is a community-driven platform where teachers can list their online courses and offline coaching batches, and students can browse, view details, and enroll directly. Teachers manage their courses/batches and track enrollments, while students discover and join courses that match their needs — all from one platform.
 
 
🧩 Layout Structure
 
Navbar
Before Login:
Left: Logo + Website Name
Middle: Home | Courses & Batches
Right: Login | Register
 
After Login:
Left: Logo + Website Name
Middle: Home | Courses & Batches | Add Listing | My Listings | My Enrollments
Right: Profile Avatar | Logout
 
Main Section
Dynamic routing with React Router — content changes based on route navigation.
 
Footer
Include:
Logo / Site Name
Short Description: "TeachOS connects teachers and students for online courses and offline coaching batches, all in one place."
Copyright
Useful Links (Home, Contact, Terms)
 
Keep the Navbar and Footer on all pages except 404 Page.
(মানে 404 Page এ navbar এবং footer থাকবেনা)
 
🏡 Pages & Functionalities
 
🏠 Home Page (Public)
 
1️⃣ Banner Section
Carousel or slider with 3+ meaningful images (classrooms, teachers, students learning)
Taglines like:
"Learn From the Best Teachers, Online or Offline!"
"One Platform for Every Course and Batch."
"Because Every Student Deserves the Right Teacher."
 
2️⃣ Category Section
Display 4 category cards:
💻 Online Course
🏫 Offline Batch
📝 Exam Preparation
🎯 Skill Course
 
Each card navigates to the filtered product list page for that category.
Route example: "/category-filtered-product/:categoryName"
This route will contain all available filtered listings/products in a 3-column grid layout.
 
3️⃣ Recent Listings
Show latest 6 listings from MongoDB (.limit(6)):
Each card includes:
Image
Name
Category
Fee (or "Free Trial Available")
Teacher's Location / Online
"See Details" button → navigates to Product/Listing Details page
 
4️⃣ Extra Sections (Add 2 Meaningful Ones)
📖 "Why Learn with TeachOS?" — a short awareness section about how learning directly from verified teachers ensures better guidance and transparent fees, without unnecessary agents in between.
👨‍🏫 "Meet Our Teachers" — show 3-4 profiles of teachers on the platform (static or from DB).
 
🔐 Authentication
Use Firebase Authentication for login/register (Email-Password + Google Login).
 
Login Page
Fields:
Email input
Password input
Login button
Google Login button
"Don't have an account? Register here"
 
Register Page
Fields:
Name input
Email input
Password input
photoURL input
Register button
Google Login button
"Already have an account? Login here"
 
Password validation:
At least 1 uppercase letter
At least 1 lowercase letter
Minimum 6 characters
 
Use react-hot-toast or SweetAlert for success/error notifications.
⚠️ Skip email verification/forgot password for simplicity.
 
🧺 Add Listing Page (Private Route)
Teachers can add new course or batch listings.
 
Form Fields:
Course/Batch Name
Category (Dropdown: Online Course, Offline Batch, Exam Preparation, Skill Course)
Fee (0 if free)
Duration (e.g., "3 Months", "10 Weeks")
Location (Online / physical area, based on category)
Description
Image (URL)
Start Date
Email = current user email (readonly)
 
After submission:
Save listing to MongoDB
Show success toast
 
📘 Courses & Batches Page (Public)
Displays all available listings in a 3-column grid layout.
Each listing card shows:
Image
Name
Category
Teacher's Location / Online
Fee
"See Details" button → Product Details Page
 
Add filters/search:
Filter by category
 
📖 Listing Details Page (Private)
Shows full details of the selected listing:
Name
Category
Teacher's Email
Description
Fee
Duration
Location
Start Date
Image
 
Button:
🎓 "Enroll Now"
Clicking on this button an Enrollment Modal will open.
 
Enrollment Form Fields
Student Name (readonly auto from user)
Email (readonly auto from user)
Course/Listing ID (readonly auto fill)
Course/Listing Name (readonly auto fill)
Seats (if category is a one-to-one/limited batch, seats will be 1)
Fee (readonly auto fill)
Address (for offline batch pickup/contact)
Date (preferred start/join date)
Phone
Additional Notes
 
After submission:
Save enrollment info to MongoDB
Show success toast
 
👨‍🏫 My Listings Page (Private)
Shows only listings created by the logged-in user (their own courses/batches).
Features:
Show the information in a tabular form
Update Button: Edit details in the modal/new update route.
Delete Button: Confirm before deleting.
Only user's own listings are shown.
 
🧾 My Enrollments Page (Private)
Displays all enrollments/orders by the logged-in user.
Each record includes:
Course/Listing Name
Student Name
Fee
Seats
Address
Date
Phone
Information will be in a tabular form
 
Feature:
🧩 "Download Report" button (Look at Challenge Part)
Export the table as a PDF (use jsPDF + jsPDF-AutoTable)
Includes only logged-in users' enrollments
 
💡 Additional Features
✅ Dynamic page title per route
✅ 404 "Page Not Found"
✅ Loading Spinner during API calls
✅ Toasts for all CRUD operations
✅ Fully responsive (mobile-first)
 
UI Design Requirements:
 
Unique Design: First, decide what kind of website you want to make. Then, search online or check out websites like ThemeForest to get ideas for the design. But remember, your website idea shouldn't be similar to any projects you've done before or to any examples in our modules or conceptual sessions.
You can also look for free resources on blogs to help with your website.
 
Keep the main heading style (font, size, color) consistent across all sections.
Keep paragraph spacing balanced and text easily readable.
Maintain uniform image sizes and spacing.
Use the same button style as on the home page.
Ensure good spacing and proper alignment.
Navbar: Keep the heading/logo same style and size as on the home page.
Use a grid layout with equal image sizes.
Keep all cards equal height and width (especially in courses/batches section).
Use the new X logo instead of the old Twitter bird to match the latest rebrand.
Responsiveness: Make it responsive for all devices, including mobile, tablet, and desktop views.
 
Resources:
https://uiverse.io/
https://devmeetsdevs.com/
https://bootcamp.uxdesign.cc/free-images-and-resources-collection-for-website-c77f2fc46ce5
https://themeforest.net/
https://codecanyon.net/
 
💪 Bonus (Challenge) Features
Download Report: Generate PDF of all enrollments by the logged-in user.
Dark/Light Mode Toggle using Tailwind.
Search by name on the Courses & Batches Page
Add Animations using any two of:
React Simple Typewriter
Framer motion
React Tooltip
 
🧱 Database Structure (MongoDB)
 
1️⃣ Collection: listings
{
 "name": "HSC Physics Batch A",
 "category": "Offline Batch",
 "fee": 1500,
 "duration": "6 Months",
 "location": "Savar, Dhaka",
 "description": "HSC Physics preparation batch covering full syllabus with weekly exams.",
 "image": "https://example.com/physics-batch.jpg",
 "email": "teacher@gmail.com",
 "startDate": "2026-09-01"
}
 
2️⃣ Collection: orders
{
 "courseId": "65488adsfadf5454f",
 "courseName": "HSC Physics Batch A",
 "studentName": "Mr. X",
 "email": "student@gmail.com",
 "seats": 1,
 "fee": 1500,
 "address": "Savar, Dhaka",
 "phone": "017xxxxxxx",
 "date": "2026-09-01",
 "additionalNotes": "Prefer evening classes"
}
 
Optional (Advanced)
Firebase Admin SDK Authorization (Server-Side)
Use Firebase Admin SDK to verify user tokens for protected API routes.
Only allow updates/deletes if the logged-in user matches the listing owner.
Initialize Admin SDK with service account in .env.
 


In Firebase Console, enable **Authentication > Sign-in method > Email/Password** and add your local app domain under **Authentication > Settings > Authorized domains** if needed. Set `FIREBASE_PROJECT_ID` in `server/.env` to the same project ID configured in `client/.env`; the server verifies Firebase ID tokens and only allows access to records owned by the signed-in account. In local demo mode, demo records are only enabled when `NODE_ENV` is not `production`. If `server/.env` does not exist, create it from `server/.env.example`; if it already exists, keep its `MONGODB_URI` and add `FIREBASE_PROJECT_ID` without replacing the file.

Teacher workspace data is saved through the Express API to MongoDB. The server automatically creates the `users`, `teacherDashboards`, `classes`, `students`, `attendanceRecords`, `lessonSessions`, `payments`, `payoutRequests`, `messages`, `officeHours`, and `resources` collections and their indexes on startup; GridFS creates its `resources.files` and `resources.chunks` collections when a file is uploaded. No manual collection creation is required.

On first use, a teacher account receives clearly marked starter classes, students, and finance records. New classes, student profiles and enrollments, attendance sessions, lesson starts, payment records, payout requests, messages, office hours, and teaching resources are saved under that account. Uploaded resource files (up to 10 MB) are stored in MongoDB GridFS. Payout requests are stored for review only and do not initiate money transfers.

Use **Attendance** in the teacher workspace to take attendance by class and date, record students as present, absent, or late, review class attendance averages, and identify students below the 85% attendance threshold.
