import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom"
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  Typography, Divider, ThemeProvider, createTheme, CssBaseline,
} from "@mui/material"
import BuildIcon from "@mui/icons-material/Build"
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks"
import ToolRegistry from "./pages/ToolRegistry"
import KnowledgeBase from "./pages/KnowledgeBase"

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
  { label: "Tool Registry", icon: <BuildIcon />, path: "/" },
  { label: "Knowledge Base", icon: <LibraryBooksIcon />, path: "/kb" },
]

function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()

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
          Healthcare Gateway
        </Typography>
        <Typography variant="h6" sx={{ color: "white", fontWeight: 700, lineHeight: 1.2, mt: 0.5 }}>
          Tool Admin
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
          <Route path="/" element={<ToolRegistry />} />
          <Route path="/kb" element={<KnowledgeBase />} />
        </Routes>
      </Box>
    </Box>
  )
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <Layout />
      </BrowserRouter>
    </ThemeProvider>
  )
}
