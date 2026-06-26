const jwt = require('jsonwebtoken');

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXZxYWhkeW9hYnBzendlZnloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNTA0MTYsImV4cCI6MjA5NzkyNjQxNn0.w5dlXko4TYhuz15-igW9eHk4sxc7XGtXUbEu9iQYfX8";
const secret = "lfsGqej5IhG+81AtWCWk7UofMDz160hAc9hcUOfZlZpO+G5k4BBv6hloXM3OPANvsK/ailEo1IUmY5VBG0K+fg==";

try {
  const decoded = jwt.verify(token, secret);
  console.log("SUCCESS:", decoded);
} catch (e) {
  console.log("ERROR verifying normal:", e.message);
}
