import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native";

// Stack navigator params for Tasks tab
export type TasksStackParamList = {
  TasksList: undefined;
  TaskDetail: { taskId: string };
};

// Stack navigator params for Projects tab
export type ProjectsStackParamList = {
  ProjectsList: undefined;
  ProjectDetail: { projectId: string };
};

// Bottom tab params
export type RootTabParamList = {
  Home: undefined;
  Tasks: NavigatorScreenParams<TasksStackParamList>;
  Board: undefined;
  Projects: NavigatorScreenParams<ProjectsStackParamList>;
  Settings: undefined;
};

// Screen props types
export type TasksListScreenProps = CompositeScreenProps<
  NativeStackScreenProps<TasksStackParamList, "TasksList">,
  BottomTabScreenProps<RootTabParamList>
>;

export type TaskDetailScreenProps = NativeStackScreenProps<TasksStackParamList, "TaskDetail">;

export type HomeScreenProps = BottomTabScreenProps<RootTabParamList, "Home">;
export type BoardScreenProps = BottomTabScreenProps<RootTabParamList, "Board">;
export type SettingsScreenProps = BottomTabScreenProps<RootTabParamList, "Settings">;
