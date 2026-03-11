import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { useWindowDimensions, Pressable, View, type ViewStyle, type StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TasksStackParamList, ProjectsStackParamList, RootTabParamList } from "./types";
import { useTheme } from "../lib/theme";

import { HomeScreen } from "../screens/HomeScreen";
import { TasksScreen } from "../screens/TasksScreen";
import { TaskDetailScreen } from "../screens/TaskDetailScreen";
import { TasksSplitViewScreen } from "../screens/TasksSplitViewScreen";
import { KanbanBoardScreen } from "../screens/KanbanBoardScreen";
import { ProjectsScreen } from "../screens/ProjectsScreen";
import { ProjectDetailScreen } from "../screens/ProjectDetailScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator<RootTabParamList>();
const TasksStack = createNativeStackNavigator<TasksStackParamList>();
const ProjectsStack = createNativeStackNavigator<ProjectsStackParamList>();

export const TABLET_BREAKPOINT = 768;

function TabBarButton(props: BottomTabBarButtonProps & { testID: string }) {
  const { testID, children, style, onPress, accessibilityState } = props;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityState={accessibilityState}
      style={style as StyleProp<ViewStyle>}
    >
      {children as React.ReactNode}
    </Pressable>
  );
}

function TasksStackNavigator() {
  return (
    <TasksStack.Navigator screenOptions={{ headerShown: false }}>
      <TasksStack.Screen name="TasksList" component={TasksScreen} />
      <TasksStack.Screen name="TaskDetail" component={TaskDetailScreen} />
    </TasksStack.Navigator>
  );
}

function ProjectsStackNavigator() {
  return (
    <ProjectsStack.Navigator screenOptions={{ headerShown: false }}>
      <ProjectsStack.Screen name="ProjectsList" component={ProjectsScreen} />
      <ProjectsStack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
    </ProjectsStack.Navigator>
  );
}

function TasksTabContent() {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;

  if (isTablet) {
    return <TasksSplitViewScreen />;
  }

  return <TasksStackNavigator />;
}

export function AppNavigator() {
  const { colors, isDark } = useTheme();

  const navigationTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: "Home",
            tabBarAccessibilityLabel: "Home Tab",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" size={size} color={color} />
            ),
            tabBarButton: (props) => <TabBarButton {...props} testID="tab-home" />,
          }}
        />
        <Tab.Screen
          name="Tasks"
          component={TasksTabContent}
          options={{
            tabBarLabel: "Tasks",
            tabBarAccessibilityLabel: "Tasks Tab",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="checkbox-outline" size={size} color={color} />
            ),
            tabBarButton: (props) => <TabBarButton {...props} testID="tab-tasks" />,
          }}
        />
        <Tab.Screen
          name="Board"
          component={KanbanBoardScreen}
          options={{
            tabBarLabel: "Board",
            tabBarAccessibilityLabel: "Board Tab",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="grid-outline" size={size} color={color} />
            ),
            tabBarButton: (props) => <TabBarButton {...props} testID="tab-board" />,
          }}
        />
        <Tab.Screen
          name="Projects"
          component={ProjectsStackNavigator}
          options={{
            tabBarLabel: "Projects",
            tabBarAccessibilityLabel: "Projects Tab",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="folder-outline" size={size} color={color} />
            ),
            tabBarButton: (props) => <TabBarButton {...props} testID="tab-projects" />,
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarLabel: "Settings",
            tabBarAccessibilityLabel: "Settings Tab",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
            tabBarButton: (props) => <TabBarButton {...props} testID="tab-settings" />,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
