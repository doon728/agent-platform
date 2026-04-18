import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom"
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  ThemeProvider,
  createTheme,
  CssBaseline,
} from "@mui/material"
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline"
import AccountTreeIcon from "@mui/icons-material/AccountTree"
import TuneIcon from "@mui/icons-material/Tune"
import DesktopWindowsIcon from "@mui/icons-material/DesktopWindows"
import SchemaIcon from "@mui/icons-material/Schema"
import ScienceIcon from "@mui/icons-material/Science"
import ExpandMoreIcon from "@mui/icons-material/ExpandMore"
import ExpandLessIcon from "@mui/icons-material/ExpandLess"
import ApplicationForm from "./components/ApplicationForm"
import PromptLifecycle from "./pages/PromptLifecycle"
import AgentRegistry from "./pages/AgentRegistry"
import Workspaces from "./pages/Workspaces"
import PipelineBuilder from "./pages/PipelineBuilder"
import ConfigLab from "./pages/ConfigLab"
import TestResults from "./pages/TestResults"
import { useState } from "react"

const DRAWER_WIDTH = 220

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1a237e" },
    background: { default: "#f5f6fa" },
  },
  typography: { fontFamily: "Inter, system-ui, sans-serif" },
})

const NAV_ITEMS = [
  { label: "Create Agent", icon: <AddCircleOutlineIcon />, path: "/" },
  { label: "Pipeline Builder", icon: <SchemaIcon />, path: "/pipeline" },
  { label: "Agent Registry", icon: <AccountTreeIcon />, path: "/registry" },
  { label: "Prompt Governance", icon: <TuneIcon />, path: "/prompts" },
  { label: "Workspaces", icon: <DesktopWindowsIcon />, path: "/workspaces" },
]

const TEST_SUB_ITEMS = [
  { label: "Config Lab", path: "/test/lab" },
  { label: "Results", path: "/test/results" },
]

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [testOpen, setTestOpen] = useState(location.pathname.startsWith("/test"))

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: DRAWER_WIDTH,
          boxSizing: "border-box",
          bgcolor: "#1a237e",
          color: "white",
        },
      }}
    >
      <Box sx={{ px: 2.5, py: 2.5 }}>
        <Typography variant="subtitle2" sx={{ color: "rgba(255,255,255,0.6)", fontWeight: 600, letterSpacing: 1, fontSize: 11, textTransform: "uppercase" }}>
          Agent Platform
        </Typography>
        <Typography variant="h6" sx={{ color: "white", fontWeight: 700, lineHeight: 1.2, mt: 0.5 }}>
          Factory
        </Typography>
      </Box>
      <Divider sx={{ borderColor: "rgba(255,255,255,0.12)" }} />
      <List sx={{ px: 1, pt: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.path
          return (
            <ListItemButton
              key={item.path}
              onClick={() => navigate(item.path)}
              sx={{
                borderRadius: 1.5,
                mb: 0.5,
                px: 1.5,
                bgcolor: active ? "rgba(255,255,255,0.15)" : "transparent",
                "&:hover": { bgcolor: "rgba(255,255,255,0.1)" },
              }}
            >
              <ListItemIcon sx={{ color: active ? "white" : "rgba(255,255,255,0.6)", minWidth: 36 }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{
                  fontSize: 13.5,
                  fontWeight: active ? 600 : 400,
                  color: active ? "white" : "rgba(255,255,255,0.75)",
                }}
              />
            </ListItemButton>
          )
        })}

        <Divider sx={{ borderColor: "rgba(255,255,255,0.12)", my: 0.5 }} />

        {/* Test parent item */}
        <ListItemButton
          onClick={() => setTestOpen(v => !v)}
          sx={{
            borderRadius: 1.5, mb: 0.5, px: 1.5,
            bgcolor: location.pathname.startsWith("/test") ? "rgba(255,255,255,0.15)" : "transparent",
            "&:hover": { bgcolor: "rgba(255,255,255,0.1)" },
          }}
        >
          <ListItemIcon sx={{ color: location.pathname.startsWith("/test") ? "white" : "rgba(255,255,255,0.6)", minWidth: 36 }}>
            <ScienceIcon />
          </ListItemIcon>
          <ListItemText
            primary="Test"
            primaryTypographyProps={{
              fontSize: 13.5,
              fontWeight: location.pathname.startsWith("/test") ? 600 : 400,
              color: location.pathname.startsWith("/test") ? "white" : "rgba(255,255,255,0.75)",
            }}
          />
          {testOpen
            ? <ExpandLessIcon sx={{ fontSize: 16, color: "rgba(255,255,255,0.5)" }} />
            : <ExpandMoreIcon sx={{ fontSize: 16, color: "rgba(255,255,255,0.5)" }} />}
        </ListItemButton>

        {/* Test sub-items */}
        {testOpen && TEST_SUB_ITEMS.map(item => {
          const active = location.pathname === item.path
          return (
            <ListItemButton
              key={item.path}
              onClick={() => navigate(item.path)}
              sx={{
                borderRadius: 1.5, mb: 0.5, pl: 4, pr: 1.5,
                bgcolor: active ? "rgba(255,255,255,0.15)" : "transparent",
                "&:hover": { bgcolor: "rgba(255,255,255,0.08)" },
              }}
            >
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{
                  fontSize: 12.5,
                  fontWeight: active ? 600 : 400,
                  color: active ? "white" : "rgba(255,255,255,0.65)",
                }}
              />
            </ListItemButton>
          )
        })}
      </List>
    </Drawer>
  )
}

function Layout() {
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <Box component="main" sx={{ flexGrow: 1, bgcolor: "background.default", minHeight: "100vh", overflow: "auto" }}>
        <Routes>
          <Route path="/" element={<ApplicationForm />} />
          <Route path="/pipeline" element={<PipelineBuilder />} />
          <Route path="/registry" element={<AgentRegistry />} />
          <Route path="/prompts" element={<PromptLifecycle />} />
          <Route path="/workspaces" element={<Workspaces />} />
          <Route path="/test/lab" element={<ConfigLab />} />
          <Route path="/test/results" element={<TestResults />} />
        </Routes>
      </Box>
    </Box>
  )
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Layout />
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
